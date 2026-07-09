import { Client, Pool } from 'pg';

export interface RecordPayload {
  [key: string]: any;
}

export interface SyncRecord {
  id: string;
  tenant_id: string;
  payload: RecordPayload;
  data_type: 'reference' | 'transactional';
  last_modified_at: Date;
  modified_by: 'desktop' | 'mobile';
  is_critical: boolean;
}

export class SyncEngine {
  private db: Client | Pool;
  private intervals: NodeJS.Timeout[] = [];

  constructor(db: Client | Pool) {
    this.db = db;
  }

  /**
   * Retrieves the last sync watermark for a given client and tenant.
   */
  async getWatermark(tenantId: string, watermarkId: string = 'default'): Promise<Date> {
    const result = await this.db.query(
      `SELECT last_sync_at FROM sync_watermarks WHERE tenant_id = $1 AND id = $2`,
      [tenantId, watermarkId]
    );
    if (result.rows.length > 0) {
      return result.rows[0].last_sync_at;
    }
    // Return epoch if no watermark exists
    return new Date(0);
  }

  /**
   * Updates the sync watermark to a new timestamp.
   */
  async updateWatermark(tenantId: string, watermarkId: string, timestamp: Date): Promise<void> {
    await this.db.query(
      `
      INSERT INTO sync_watermarks (id, tenant_id, last_sync_at) 
      VALUES ($1, $2, $3)
      ON CONFLICT (tenant_id, id) DO UPDATE SET last_sync_at = EXCLUDED.last_sync_at
      `,
      [watermarkId, tenantId, timestamp]
    );
  }

  /**
   * Queries the delta of records modified after the given watermark, filtered by data type and tenant.
   */
  async getDelta(
    tenantId: string,
    tableName: 'client_records' | 'cloud_records', 
    watermark: Date,
    dataType?: 'reference' | 'transactional'
  ): Promise<SyncRecord[]> {
    if (tableName !== 'client_records' && tableName !== 'cloud_records') {
      throw new Error('Invalid table name');
    }

    let query = `SELECT * FROM ${tableName} WHERE tenant_id = $1 AND last_modified_at > $2`;
    const params: any[] = [tenantId, watermark];

    if (dataType) {
      query += ` AND data_type = $3`;
      params.push(dataType);
    }
    
    query += ` ORDER BY last_modified_at ASC`;

    const result = await this.db.query(query, params);
    return result.rows as SyncRecord[];
  }

  /**
   * Processes the sync for a given data type and tenant.
   */
  async processSync(tenantId: string, dataType: 'reference' | 'transactional') {
    console.log(`Processing ${dataType} sync for tenant ${tenantId} at ${new Date().toISOString()}`);
    const watermarkId = `${dataType}_sync`;
    const watermark = await this.getWatermark(tenantId, watermarkId);

    const clientDelta = await this.getDelta(tenantId, 'client_records', watermark, dataType);
    const cloudDelta = await this.getDelta(tenantId, 'cloud_records', watermark, dataType);

    await this.resolveConflicts(tenantId, clientDelta, cloudDelta);

    // Update watermark after successful sync to the highest processed timestamp
    const allRecords = [...clientDelta, ...cloudDelta];
    if (allRecords.length > 0) {
      const highestTimestamp = new Date(Math.max(...allRecords.map(r => r.last_modified_at.getTime())));
      await this.updateWatermark(tenantId, watermarkId, highestTimestamp);
    }
  }

  /**
   * Resolves conflicts between client and cloud records.
   */
  async resolveConflicts(tenantId: string, clientRecords: SyncRecord[], cloudRecords: SyncRecord[]): Promise<void> {
    const clientMap = new Map<string, SyncRecord>();
    const cloudMap = new Map<string, SyncRecord>();
    
    for (const r of clientRecords) clientMap.set(r.id, r);
    for (const r of cloudRecords) cloudMap.set(r.id, r);

    const allIds = new Set([...clientMap.keys(), ...cloudMap.keys()]);

    for (const id of allIds) {
      const clientRecord = clientMap.get(id);
      const cloudRecord = cloudMap.get(id);

      if (clientRecord && cloudRecord) {
        // Conflict exists, both have modifications
        let clientWins = false;

        // Rule 2: Exception - Critical Desktop overrides Mobile
        if (clientRecord.is_critical && clientRecord.modified_by === 'desktop' && cloudRecord.modified_by === 'mobile') {
          clientWins = true;
          await this.sendToDLQ(cloudRecord, 'Mobile update rejected due to critical desktop override');
        } else if (cloudRecord.is_critical && cloudRecord.modified_by === 'desktop' && clientRecord.modified_by === 'mobile') {
          clientWins = false;
          await this.sendToDLQ(clientRecord, 'Mobile update rejected due to critical desktop override');
        } else {
          // Rule 1: Default - Last-Write-Wins (LWW)
          clientWins = clientRecord.last_modified_at.getTime() > cloudRecord.last_modified_at.getTime();
        }

        if (clientWins) {
          await this.writeToCloud(clientRecord);
        } else {
          await this.writeToClient(cloudRecord);
        }
      } else if (clientRecord) {
        // Only client modified
        await this.writeToCloud(clientRecord);
      } else if (cloudRecord) {
        // Only cloud modified
        await this.writeToClient(cloudRecord);
      }
    }
  }

  private async sendToDLQ(record: SyncRecord, reason: string): Promise<void> {
    await this.db.query(
      `INSERT INTO dead_letter_queue (id, tenant_id, payload, data_type, last_modified_at, modified_by, is_critical, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, id) DO UPDATE SET payload = EXCLUDED.payload, reason = EXCLUDED.reason`,
      [record.id, record.tenant_id, record.payload, record.data_type, record.last_modified_at, record.modified_by, record.is_critical, reason]
    );
  }

  private async writeToCloud(record: SyncRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO cloud_records (id, tenant_id, payload, data_type, last_modified_at, modified_by, is_critical)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, id) DO UPDATE SET payload = EXCLUDED.payload, last_modified_at = EXCLUDED.last_modified_at, modified_by = EXCLUDED.modified_by, is_critical = EXCLUDED.is_critical`,
      [record.id, record.tenant_id, record.payload, record.data_type, record.last_modified_at, record.modified_by, record.is_critical]
    );
  }

  private async writeToClient(record: SyncRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO client_records (id, tenant_id, payload, data_type, last_modified_at, modified_by, is_critical)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, id) DO UPDATE SET payload = EXCLUDED.payload, last_modified_at = EXCLUDED.last_modified_at, modified_by = EXCLUDED.modified_by, is_critical = EXCLUDED.is_critical`,
      [record.id, record.tenant_id, record.payload, record.data_type, record.last_modified_at, record.modified_by, record.is_critical]
    );
  }

  /**
   * Starts separate intervals for Reference (less frequent) and Transactional (continuous) data for multiple tenants concurrently.
   */
  startSyncIntervals(tenantIds: string[], referenceMs: number = 60000, transactionalMs: number = 5000) {
    if (this.intervals.length > 0) {
      throw new Error('Intervals are already running');
    }

    for (const tenantId of tenantIds) {
      // Reference data syncs less frequently
      this.intervals.push(setInterval(() => {
        this.processSync(tenantId, 'reference').catch(console.error);
      }, referenceMs));

      // Transactional data syncs continuously
      this.intervals.push(setInterval(() => {
        this.processSync(tenantId, 'transactional').catch(console.error);
      }, transactionalMs));
    }
  }

  stopSyncIntervals() {
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];
  }
}
