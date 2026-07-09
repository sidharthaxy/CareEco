import { SyncEngine } from './SyncEngine';
import { newDb } from 'pg-mem';
import { randomUUID } from 'crypto';

describe('SyncEngine', () => {
  let engine: SyncEngine;
  let db: any;
  const tenantId = randomUUID();

  beforeEach(async () => {
    const memDb = newDb();
    
    // Create the schema
    memDb.public.none(`
      CREATE TABLE client_records (
        id UUID,
        tenant_id UUID NOT NULL,
        payload JSONB NOT NULL,
        data_type VARCHAR(50) NOT NULL,
        last_modified_at TIMESTAMP NOT NULL,
        modified_by VARCHAR(50) NOT NULL,
        is_critical BOOLEAN NOT NULL DEFAULT false,
        PRIMARY KEY (tenant_id, id)
      );
      CREATE TABLE cloud_records (
        id UUID,
        tenant_id UUID NOT NULL,
        payload JSONB NOT NULL,
        data_type VARCHAR(50) NOT NULL,
        last_modified_at TIMESTAMP NOT NULL,
        modified_by VARCHAR(50) NOT NULL,
        is_critical BOOLEAN NOT NULL DEFAULT false,
        PRIMARY KEY (tenant_id, id)
      );
      CREATE TABLE dead_letter_queue (
        id UUID,
        tenant_id UUID NOT NULL,
        payload JSONB NOT NULL,
        data_type VARCHAR(50) NOT NULL,
        last_modified_at TIMESTAMP NOT NULL,
        modified_by VARCHAR(50) NOT NULL,
        is_critical BOOLEAN NOT NULL DEFAULT false,
        reason TEXT NOT NULL,
        rejected_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (tenant_id, id)
      );
      CREATE TABLE sync_watermarks (
        id VARCHAR(50),
        tenant_id UUID NOT NULL,
        last_sync_at TIMESTAMP NOT NULL DEFAULT '1970-01-01T00:00:00Z',
        PRIMARY KEY (tenant_id, id)
      );
    `);

    db = memDb.adapters.createPg().Pool;
    // @ts-ignore
    engine = new SyncEngine(new db());
  });

  test('should only sync records modified after watermark', async () => {
    const id1 = randomUUID();
    const id2 = randomUUID();
    const watermark = new Date('2023-01-01T00:00:00Z');
    await engine.updateWatermark(tenantId, 'reference_sync', watermark);

    // Old record (before watermark)
    await engine['db'].query(
      `INSERT INTO client_records (id, tenant_id, payload, data_type, last_modified_at, modified_by, is_critical)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id1, tenantId, JSON.stringify({ old: true }), 'reference', new Date('2022-12-31T00:00:00Z'), 'desktop', false]
    );

    // New record (after watermark)
    await engine['db'].query(
      `INSERT INTO client_records (id, tenant_id, payload, data_type, last_modified_at, modified_by, is_critical)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id2, tenantId, JSON.stringify({ new: true }), 'reference', new Date('2023-01-02T00:00:00Z'), 'desktop', false]
    );

    const delta = await engine.getDelta(tenantId, 'client_records', watermark, 'reference');
    expect(delta).toHaveLength(1);
    expect(delta[0].id).toBe(id2);
  });

  test('should resolve conflicts using Last-Write-Wins by default', async () => {
    const id = randomUUID();
    
    // Client has newer timestamp
    const clientRecord = {
      id, tenant_id: tenantId, payload: { val: 'client' }, data_type: 'reference' as const,
      last_modified_at: new Date('2023-01-02T00:00:00Z'), modified_by: 'mobile' as const, is_critical: false
    };

    // Cloud has older timestamp
    const cloudRecord = {
      id, tenant_id: tenantId, payload: { val: 'cloud' }, data_type: 'reference' as const,
      last_modified_at: new Date('2023-01-01T00:00:00Z'), modified_by: 'desktop' as const, is_critical: false
    };

    await engine.resolveConflicts(tenantId, [clientRecord], [cloudRecord]);

    // Client should have won, so cloud_records should be updated
    const res = await engine['db'].query('SELECT * FROM cloud_records WHERE id = $1', [id]);
    expect(res.rows[0].payload.val).toBe('client');
  });

  test('should override LWW and route to DLQ if desktop flags as critical', async () => {
    const id = randomUUID();
    
    // Mobile has newer timestamp but is not critical
    const clientRecord = {
      id, tenant_id: tenantId, payload: { val: 'mobile' }, data_type: 'transactional' as const,
      last_modified_at: new Date('2023-01-02T00:00:00Z'), modified_by: 'mobile' as const, is_critical: false
    };

    // Desktop has older timestamp but is critical
    const cloudRecord = {
      id, tenant_id: tenantId, payload: { val: 'desktop' }, data_type: 'transactional' as const,
      last_modified_at: new Date('2023-01-01T00:00:00Z'), modified_by: 'desktop' as const, is_critical: true
    };

    await engine.resolveConflicts(tenantId, [clientRecord], [cloudRecord]);

    // DLQ should contain the rejected mobile record
    const dlqRes = await engine['db'].query('SELECT * FROM dead_letter_queue WHERE id = $1', [id]);
    expect(dlqRes.rows).toHaveLength(1);
    expect(dlqRes.rows[0].payload.val).toBe('mobile');
    expect(dlqRes.rows[0].reason).toContain('critical desktop override');

    // Desktop record should be written to client
    const clientRes = await engine['db'].query('SELECT * FROM client_records WHERE id = $1', [id]);
    expect(clientRes.rows).toHaveLength(1);
    expect(clientRes.rows[0].payload.val).toBe('desktop');
  });

  test('should sync reference data and transactional data independently', async () => {
    const processSyncSpy = jest.spyOn(engine, 'processSync').mockImplementation(async () => {});
    
    engine.startSyncIntervals([tenantId], 50, 10);
    
    // Wait for a short time
    await new Promise(resolve => setTimeout(resolve, 80));
    engine.stopSyncIntervals();

    // Transactional (10ms) should have run more times than Reference (50ms)
    const calls = processSyncSpy.mock.calls;
    const refCalls = calls.filter(c => c[1] === 'reference').length;
    const transCalls = calls.filter(c => c[1] === 'transactional').length;

    expect(refCalls).toBeGreaterThan(0);
    expect(transCalls).toBeGreaterThan(refCalls);
  });
});
