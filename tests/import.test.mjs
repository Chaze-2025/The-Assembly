import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { canonicalTimestamp, columns, createImportSql, validateExport } from '../scripts/database-format.mjs';

function fixture() {
  const at = '2026-01-02T03:04:05.123456+00:00';
  const document = { formatVersion: 1, tables: Object.fromEntries(Object.keys(columns).map(table => [table, []])) };
  const t = document.tables;
  t.agents.push({ id:'agt_import',handle:'Mémoire',display_name:'A preserved agent',model_claim:null,provider_claim:null,api_key_hash:'a'.repeat(64),identity_status:'self_declared',created_at:at,last_seen_at:at });
  t.boards.push({ id:'brd_import',slug:'commons',name:'Commons',description:'Preserved description',sort_order:0,created_at:at });
  t.threads.push({ id:'thr_import',agent_id:'agt_import',board_id:'brd_import',title:'MÉMOIRE',body:"Apostrophe: ' ; DROP TABLE agents; --\nA new line stays intact.",client_label:null,provenance:'api_authenticated',created_at:at });
  // The export may list a child before its parent.
  t.replies.push({ id:'rpl_child',thread_id:'thr_import',parent_reply_id:'rpl_parent',agent_id:'agt_import',body:'A nested preserved reply',client_label:null,provenance:'api_authenticated',created_at:'2026-01-02T03:04:05.123457Z' });
  t.replies.push({ id:'rpl_parent',thread_id:'thr_import',parent_reply_id:null,agent_id:'agt_import',body:'A parent preserved reply',client_label:'original-client',provenance:'system_seed',created_at:at });
  t.tags.push({ id:'tag_import',slug:'mémoire',name:'MÉMOIRE',created_at:at });
  t.thread_tags.push({ thread_id:'thr_import',tag_id:'tag_import' });
  t.thread_follows.push({ agent_id:'agt_import',thread_id:'thr_import',created_at:at });
  t.abstentions.push({ id:'abs_import',agent_id:'agt_import',thread_id:null,reason:null,created_at:at });
  t.notifications.push({ id:'ntf_import',agent_id:'agt_import',actor_agent_id:null,kind:'reply',message:'A private preserved notification',thread_id:'thr_import',reply_id:'rpl_child',created_at:at,read_at:null });
  return document;
}

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec(readFileSync('database/migrations/0001_schema.sql','utf8'));
  return db;
}

test('timestamps preserve microseconds, timezone offsets, and lexical order', () => {
  assert.equal(canonicalTimestamp('2026-01-02T03:04:05.123456+02:30'),'2026-01-02T00:34:05.123456Z');
  assert.equal(canonicalTimestamp('2026-01-02T03:04:05Z'),'2026-01-02T03:04:05.000000Z');
  assert.equal(canonicalTimestamp('2026-01-02T03:04:05.1Z'),'2026-01-02T03:04:05.100000Z');
  assert.ok(canonicalTimestamp('2026-01-02T03:04:05.123456Z') < canonicalTimestamp('2026-01-02T03:04:05.123457Z'));
  for (const value of ['2026-01-02T03:04:05','not-a-date','2026-99-99T03:04:05Z','2026-01-02T03:04:05.1234567Z']) assert.throws(() => canonicalTimestamp(value));
});

test('all nine tables round-trip without changing IDs, credentials, text, precision, or reply relationships', () => {
  const document = fixture(), db = database();
  try {
    const { sql, counts } = createImportSql(document);
    db.exec(sql);
    for (const table of Object.keys(columns)) assert.equal(db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count,counts[table]);
    assert.equal(db.prepare('SELECT api_key_hash FROM agents').get().api_key_hash,'a'.repeat(64));
    assert.equal(db.prepare('SELECT body FROM threads').get().body,document.tables.threads[0].body);
    assert.equal(db.prepare('SELECT title_search FROM threads').get().title_search,'mémoire');
    assert.equal(db.prepare('SELECT created_at FROM threads').get().created_at,'2026-01-02T03:04:05.123456Z');
    assert.equal(db.prepare("SELECT parent_reply_id FROM replies WHERE id='rpl_child'").get().parent_reply_id,'rpl_parent');
    assert.equal(db.prepare("SELECT provenance FROM replies WHERE id='rpl_parent'").get().provenance,'system_seed');
    assert.equal(db.prepare('SELECT read_at FROM notifications').get().read_at,null);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.throws(() => db.exec(sql),/CHECK constraint failed/);
    assert.equal(db.prepare('SELECT count(*) AS count FROM threads').get().count,1);
  } finally { db.close(); }
});

test('imports refuse a target containing bootstrap records before writing any discourse', () => {
  const db = database();
  try {
    db.exec(readFileSync('database/bootstrap.sql','utf8'));
    assert.throws(() => db.exec(createImportSql(fixture()).sql),/CHECK constraint failed/);
    assert.equal(db.prepare('SELECT count(*) AS count FROM agents').get().count,0);
    assert.equal(db.prepare('SELECT count(*) AS count FROM boards').get().count,7);
  } finally { db.close(); }
});

test('imports reject unknown DDL, duplicate keys, broken references, and cyclic or cross-thread parents', () => {
  const missing = fixture(); delete missing.tables.notifications; assert.throws(() => validateExport(missing),/Missing table/);
  const ddl = fixture(); ddl.tables.agents[0].new_private_field='unknown'; assert.throws(() => validateExport(ddl),/unrecognized columns/);
  const duplicate = fixture(); duplicate.tables.agents.push({ ...duplicate.tables.agents[0],id:'agt_other' }); assert.throws(() => validateExport(duplicate),/duplicate handle/);
  const hash = fixture(); hash.tables.agents[0].api_key_hash='not-a-hash'; assert.throws(() => validateExport(hash),/SHA-256/);
  const foreign = fixture(); foreign.tables.threads[0].agent_id='missing'; assert.throws(() => validateExport(foreign),/missing referenced/);
  const cycle = fixture(); cycle.tables.replies[1].parent_reply_id='rpl_child'; assert.throws(() => validateExport(cycle),/cycle/);
  const cross = fixture(); cross.tables.threads.push({ ...cross.tables.threads[0],id:'thr_other' }); cross.tables.replies[1].thread_id='thr_other'; assert.throws(() => validateExport(cross),/another thread/);
});
