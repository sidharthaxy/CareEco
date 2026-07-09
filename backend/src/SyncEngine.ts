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
   * Queries the delta of records modified after the given watermark.
   */
  async getDelta(tableName: 'client_records' | 'cloud_records', watermark: Date): Promise<SyncRecord[]> {
    // Basic validation to prevent SQL injection on table name
    if (tableName !== 'client_records' && tableName !== 'cloud_records') {
      throw new Error('Invalid table name');
    }

    const result = await this.db.query(
      `SELECT * FROM ${tableName} WHERE last_modified_at > $1 ORDER BY last_modified_at ASC`,
      [watermark]
    );
    return result.rows as SyncRecord[];
  }
}
