import { Client, Pool } from 'pg';

export interface RecordPayload {
  [key: string]: any;
}

export interface SyncRecord {
  id: string;
  payload: RecordPayload;
  data_type: 'reference' | 'transactional';
  last_modified_at: Date;
  modified_by: 'desktop' | 'mobile';
  is_critical: boolean;
}

export class SyncEngine {
  private db: Client | Pool;
  private referenceInterval: NodeJS.Timeout | null = null;
  private transactionalInterval: NodeJS.Timeout | null = null;

  constructor(db: Client | Pool) {
    this.db = db;
  }

  /**
   * Retrieves the last sync watermark for a given client (or a default ID if single-client).
   */
  async getWatermark(watermarkId: string = 'default'): Promise<Date> {
    const result = await this.db.query(
      `SELECT last_sync_at FROM sync_watermarks WHERE id = $1`,
      [watermarkId]
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
  async updateWatermark(watermarkId: string, timestamp: Date): Promise<void> {
    await this.db.query(
      `
      INSERT INTO sync_watermarks (id, last_sync_at) 
      VALUES ($1, $2)
      ON CONFLICT (id) DO UPDATE SET last_sync_at = EXCLUDED.last_sync_at
      `,
      [watermarkId, timestamp]
    );
  }

  /**
   * Queries the delta of records modified after the given watermark, filtered by data type.
   */
  async getDelta(
    tableName: 'client_records' | 'cloud_records', 
    watermark: Date,
    dataType?: 'reference' | 'transactional'
  ): Promise<SyncRecord[]> {
    if (tableName !== 'client_records' && tableName !== 'cloud_records') {
      throw new Error('Invalid table name');
    }

    let query = `SELECT * FROM ${tableName} WHERE last_modified_at > $1`;
    const params: any[] = [watermark];

    if (dataType) {
      query += ` AND data_type = $2`;
      params.push(dataType);
    }
    
    query += ` ORDER BY last_modified_at ASC`;

    const result = await this.db.query(query, params);
    return result.rows as SyncRecord[];
  }

  /**
   * Simulates the separate sync processes.
   */
  async processSync(dataType: 'reference' | 'transactional') {
    // This is a placeholder for the actual conflict resolution (Step 5)
    console.log(`Processing ${dataType} sync at ${new Date().toISOString()}`);
    // Example: const watermark = await this.getWatermark(\`\${dataType}_sync\`);
    // Example: const clientDelta = await this.getDelta('client_records', watermark, dataType);
    // Example: const cloudDelta = await this.getDelta('cloud_records', watermark, dataType);
  }

  /**
   * Starts separate intervals for Reference (less frequent) and Transactional (continuous) data.
   */
  startSyncIntervals(referenceMs: number = 60000, transactionalMs: number = 5000) {
    if (this.referenceInterval || this.transactionalInterval) {
      throw new Error('Intervals are already running');
    }

    // Reference data syncs less frequently
    this.referenceInterval = setInterval(() => {
      this.processSync('reference').catch(console.error);
    }, referenceMs);

    // Transactional data syncs continuously
    this.transactionalInterval = setInterval(() => {
      this.processSync('transactional').catch(console.error);
    }, transactionalMs);
  }

  stopSyncIntervals() {
    if (this.referenceInterval) clearInterval(this.referenceInterval);
    if (this.transactionalInterval) clearInterval(this.transactionalInterval);
    this.referenceInterval = null;
    this.transactionalInterval = null;
  }
}
