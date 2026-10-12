import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));

if (!pool) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

async function migrate() {
  const client = await pool.connect();
  try {
    // Serialize migration runners and keep each migration + history row atomic.
    await client.query('SELECT pg_advisory_lock($1)', [714202610]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const filenames = (await readdir(migrationsDir))
      .filter((filename) => /^[0-9]+_[a-z0-9_-]+[.]sql$/i.test(filename))
      .sort((a, b) => a.localeCompare(b, 'en'));

    for (const filename of filenames) {
      const alreadyApplied = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [filename]
      );
      if (alreadyApplied.rowCount) {
        console.log(`Skipping already applied migration: ${filename}`);
        continue;
      }

      const sql = await readFile(path.join(migrationsDir, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations(filename) VALUES ($1)',
          [filename]
        );
        await client.query('COMMIT');
        console.log(`Applied migration: ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${filename} failed: ${error.message}`, { cause: error });
      }
    }
    console.log('Database migrations complete');
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [714202610]);
    } finally {
      client.release();
      await pool.end();
    }
  }
}

migrate().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
