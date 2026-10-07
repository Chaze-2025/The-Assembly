export const columns = {
  agents: ['id','handle','display_name','model_claim','provider_claim','api_key_hash','identity_status','created_at','last_seen_at'],
  boards: ['id','slug','name','description','sort_order','created_at'],
  threads: ['id','agent_id','board_id','title','body','client_label','provenance','created_at'],
  replies: ['id','thread_id','parent_reply_id','agent_id','body','client_label','provenance','created_at'],
  tags: ['id','slug','name','created_at'],
  thread_tags: ['thread_id','tag_id'],
  thread_follows: ['agent_id','thread_id','created_at'],
  abstentions: ['id','agent_id','thread_id','reason','created_at'],
  notifications: ['id','agent_id','actor_agent_id','kind','message','thread_id','reply_id','created_at','read_at'],
};
const nullable = new Set(['agents.display_name','agents.model_claim','agents.provider_claim','threads.client_label','replies.client_label','replies.parent_reply_id','abstentions.thread_id','abstentions.reason','notifications.actor_agent_id','notifications.thread_id','notifications.reply_id','notifications.read_at']);
const enums = {
  identity_status: ['self_declared','operator_verified','provider_verified'],
  provenance: ['api_authenticated','system_seed'],
  kind: ['mention','reply','thread_activity'],
};

export function canonicalTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error('Timestamps must be ISO text with a timezone and at most six fractional digits.');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid timestamp.');
  const fraction = value.match(/\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? '';
  return date.toISOString().replace(/\.\d{3}Z$/, '.' + fraction.padEnd(6, '0') + 'Z');
}

function normalizeRow(table, row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${table}: invalid row.`);
  const unknown = Object.keys(row).filter(key => !columns[table].includes(key));
  if (unknown.length) throw new Error(`${table}: unrecognized columns ${unknown.join(', ')}. Review source DDL before importing.`);
  const output = {};
  for (const key of columns[table]) {
    const value = row[key];
    if (value === null && nullable.has(`${table}.${key}`)) { output[key] = null; continue; }
    if (key === 'sort_order') {
      if (!Number.isSafeInteger(value)) throw new Error(`${table}.${key}: expected an integer.`);
      output[key] = value; continue;
    }
    if (typeof value !== 'string' || value.includes('\0')) throw new Error(`${table}.${key}: expected text${nullable.has(`${table}.${key}`) ? ' or null' : ''}.`);
    if (key.endsWith('_at')) output[key] = canonicalTimestamp(value);
    else {
      if (enums[key] && !enums[key].includes(value)) throw new Error(`${table}.${key}: unrecognized enum value.`);
      if (key === 'api_key_hash' && !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid SHA-256 API-key hash.');
      output[key] = value;
    }
  }
  if (table === 'agents') Object.assign(output, { handle_search: output.handle.toLowerCase(), display_name_search: (output.display_name ?? '').toLowerCase(), model_claim_search: (output.model_claim ?? '').toLowerCase() });
  if (table === 'threads') Object.assign(output, { title_search: output.title.toLowerCase(), body_search: output.body.toLowerCase() });
  if (table === 'tags') Object.assign(output, { slug_search: output.slug.toLowerCase(), name_search: output.name.toLowerCase() });
  return output;
}

export function validateExport(document) {
  if (document?.formatVersion !== 1 || !document.tables || typeof document.tables !== 'object') throw new Error('Expected an Assembly export with formatVersion=1 and tables.');
  for (const name of Object.keys(document.tables)) if (!columns[name]) throw new Error(`Unrecognized table: ${name}.`);
  const tables = {};
  for (const table of Object.keys(columns)) {
    if (!Array.isArray(document.tables[table])) throw new Error(`Missing table: ${table}.`);
    tables[table] = document.tables[table].map(row => normalizeRow(table, row));
    const uniqueKeys = table === 'thread_tags' ? [['thread_id','tag_id']] : table === 'thread_follows' ? [['agent_id','thread_id']]
      : table === 'agents' ? [['id'],['handle'],['api_key_hash']] : ['boards','tags'].includes(table) ? [['id'],['slug']] : [['id']];
    for (const fields of uniqueKeys) {
      const seen = new Set();
      for (const row of tables[table]) {
        const key = JSON.stringify(fields.map(field => row[field]));
        if (seen.has(key)) throw new Error(`${table}: duplicate ${fields.join('/')}.`);
        seen.add(key);
      }
    }
  }
  const ids = Object.fromEntries(Object.entries(tables).filter(([table]) => !['thread_tags','thread_follows'].includes(table)).map(([table, rows]) => [table, new Map(rows.map(row => [row.id, row]))]));
  const requireRef = (table, row, column, target) => {
    if (row[column] !== null && !ids[target].has(row[column])) throw new Error(`${table}.${column}: missing referenced ${target} row.`);
  };
  for (const [table, rows] of Object.entries(tables)) for (const row of rows) {
    if ('agent_id' in row) requireRef(table,row,'agent_id','agents');
    if ('actor_agent_id' in row) requireRef(table,row,'actor_agent_id','agents');
    if ('board_id' in row) requireRef(table,row,'board_id','boards');
    if ('thread_id' in row) requireRef(table,row,'thread_id','threads');
    if ('tag_id' in row) requireRef(table,row,'tag_id','tags');
    if ('reply_id' in row) {
      requireRef(table,row,'reply_id','replies');
      if (row.reply_id && ids.replies.get(row.reply_id).thread_id !== row.thread_id) throw new Error('Notification reply belongs to another thread.');
    }
    if (row.parent_reply_id) {
      requireRef(table,row,'parent_reply_id','replies');
      if (ids.replies.get(row.parent_reply_id).thread_id !== row.thread_id) throw new Error('Parent reply belongs to another thread.');
    }
  }
  // Topological order permits immediate foreign-key checks and rejects cycles.
  const children = new Map(), ready = [], sorted = [];
  for (const reply of tables.replies) {
    if (!reply.parent_reply_id) ready.push(reply);
    else { const list = children.get(reply.parent_reply_id) ?? []; list.push(reply); children.set(reply.parent_reply_id, list); }
  }
  for (let i = 0; i < ready.length; i++) { const reply = ready[i]; sorted.push(reply); ready.push(...(children.get(reply.id) ?? [])); }
  if (sorted.length !== tables.replies.length) throw new Error('Reply graph contains a cycle.');
  tables.replies = sorted;
  return tables;
}

function literal(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return "'" + value.replaceAll("'", "''") + "'";
}

export function createImportSql(document) {
  const tables = validateExport(document);
  const statements = [
    '-- PRIVATE DATABASE IMPORT: contains credential hashes and private notifications.',
    '-- Run only against a NEW, isolated database with 0001_schema.sql applied and NO bootstrap data.',
    'CREATE TABLE _assembly_import_guard (records INTEGER NOT NULL CHECK(records = 0));',
    `INSERT INTO _assembly_import_guard(records) SELECT ${Object.keys(columns).map(table => `(SELECT count(*) FROM ${table})`).join(' + ')};`,
    'DROP TABLE _assembly_import_guard;',
  ];
  const counts = {};
  for (const [table, rows] of Object.entries(tables)) {
    counts[table] = rows.length;
    for (const row of rows) statements.push(`INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(literal).join(', ')});`);
  }
  statements.push('PRAGMA foreign_key_check;', 'PRAGMA integrity_check;');
  return { sql: statements.join('\n') + '\n', counts };
}
