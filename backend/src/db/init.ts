import { Client } from 'pg';

const client = new Client({
  host: 'localhost',
  port: 5432,
  user: 'user',
  password: 'password',
  database: 'sync_db',
});

async function run() {
  await client.connect();

  console.log('Connected to PostgreSQL database');

  try {
    // 1. client_records
    await client.query(`
      CREATE TABLE IF NOT EXISTS client_records (
        id UUID PRIMARY KEY,
        payload JSONB NOT NULL,
        data_type VARCHAR(50) NOT NULL CHECK (data_type IN ('reference', 'transactional')),
        last_modified_at TIMESTAMP WITH TIME ZONE NOT NULL,
        modified_by VARCHAR(50) NOT NULL CHECK (modified_by IN ('desktop', 'mobile')),
        is_critical BOOLEAN NOT NULL DEFAULT false
      );
    `);

    // 2. cloud_records
    await client.query(`
      CREATE TABLE IF NOT EXISTS cloud_records (
        id UUID PRIMARY KEY,
        payload JSONB NOT NULL,
        data_type VARCHAR(50) NOT NULL CHECK (data_type IN ('reference', 'transactional')),
        last_modified_at TIMESTAMP WITH TIME ZONE NOT NULL,
        modified_by VARCHAR(50) NOT NULL CHECK (modified_by IN ('desktop', 'mobile')),
        is_critical BOOLEAN NOT NULL DEFAULT false
      );
    `);

    // 3. dead_letter_queue
    await client.query(`
      CREATE TABLE IF NOT EXISTS dead_letter_queue (
        id UUID PRIMARY KEY,
        payload JSONB NOT NULL,
        data_type VARCHAR(50) NOT NULL CHECK (data_type IN ('reference', 'transactional')),
        last_modified_at TIMESTAMP WITH TIME ZONE NOT NULL,
        modified_by VARCHAR(50) NOT NULL CHECK (modified_by IN ('desktop', 'mobile')),
        is_critical BOOLEAN NOT NULL DEFAULT false,
        reason TEXT NOT NULL,
        rejected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 4. sync_watermarks
    await client.query(`
      CREATE TABLE IF NOT EXISTS sync_watermarks (
        id VARCHAR(50) PRIMARY KEY,
        last_sync_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT '1970-01-01T00:00:00Z'
      );
    `);

    console.log('Database schema created successfully.');
  } catch (error) {
    console.error('Error creating database schema:', error);
  } finally {
    await client.end();
  }
}

run();
