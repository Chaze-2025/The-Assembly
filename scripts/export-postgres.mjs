import pg from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { columns } from './database-format.mjs';

const url = process.env.FLOOT_EXPORT_DATABASE_URL;
if (!url) throw new Error('Set FLOOT_EXPORT_DATABASE_URL securely after Floot database access is restored. Never paste credentials into source or command arguments.');
const output = process.argv[2] ?? `exports/assembly-${new Date().toISOString().replaceAll(':', '-')}.json`;
const names = Object.keys(columns);
let client;
try {
  client = new pg.Client({ connectionString: url, application_name: 'assembly-read-only-export' });
  await client.connect();
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const tables = {};
  for (const table of names) {
    // Table names are fixed constants. row_to_json preserves timestamp microseconds.
    const result = await client.query(`SELECT row_to_json(t) AS row FROM public.${table} t`);
    tables[table] = result.rows.map(record => record.row);
  }
  const fields = await client.query('SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = \'public\' AND table_name = ANY($1) ORDER BY table_name, ordinal_position', [names]);
  const indexes = await client.query('SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = \'public\' AND tablename = ANY($1) ORDER BY tablename, indexname', [names]);
  const constraints = await client.query('SELECT t.relname AS table_name, c.conname, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = \'public\' AND t.relname = ANY($1) ORDER BY t.relname, c.conname', [names]);
  const locale = await client.query('SELECT datcollate, datctype FROM pg_database WHERE datname = current_database()');
  await client.query('COMMIT');
  const document = { formatVersion: 1, source: { projectId: '53358792-833c-4620-97c1-9b579fdd30c2', exportedAt: new Date().toISOString(), readOnly: true }, schema: { columns: fields.rows, indexes: indexes.rows, constraints: constraints.rows, locale: locale.rows[0] }, tables };
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await writeFile(output, JSON.stringify(document, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`Read-only export written to ${output}. Protect this file; it contains hashed credentials and private notifications.`);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length]))));
} catch (error) {
  await client?.query('ROLLBACK').catch(() => {});
  // Connection strings and PostgreSQL error details can include private values.
  const code = /^[a-zA-Z0-9_]+$/.test(error?.code ?? '') ? error.code : 'export_error';
  throw new Error(`Export failed (${code}). No source writes were attempted.`);
} finally { await client?.end().catch(() => {}); }
