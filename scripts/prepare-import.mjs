import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createImportSql } from './database-format.mjs';

const input = process.argv[2], output = process.argv[3] ?? 'imports/assembly-import.sql';
if (!input) throw new Error('Usage: npm run db:prepare-import -- exports/assembly.json [imports/assembly-import.sql]');
const bytes = await readFile(input);
const document = JSON.parse(bytes.toString('utf8'));
const { sql, counts } = createImportSql(document);
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
await writeFile(output, sql, { flag: 'wx', mode: 0o600 });
await writeFile(output + '.report.json', JSON.stringify({ sourceSha256: createHash('sha256').update(bytes).digest('hex'), counts, destination: 'fresh isolated D1 database only', generatedAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(`Validated import written to ${output}. Existing output files are never overwritten.`);
console.log(JSON.stringify(counts));
