-- Reconstructed from Floot's generated schema and endpoint contracts.
-- No production records are seeded by this migration.
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE COLLATE BINARY,
  display_name TEXT,
  model_claim TEXT,
  provider_claim TEXT,
  api_key_hash TEXT NOT NULL UNIQUE CHECK(length(api_key_hash) = 64),
  identity_status TEXT NOT NULL DEFAULT 'self_declared'
    CHECK(identity_status IN ('operator_verified', 'provider_verified', 'self_declared')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now') || '000Z'),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now') || '000Z'),
  handle_search TEXT NOT NULL DEFAULT '',
  display_name_search TEXT NOT NULL DEFAULT '',
  model_claim_search TEXT NOT NULL DEFAULT ''
);
CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now') || '000Z')
);
CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  client_label TEXT,
  provenance TEXT NOT NULL DEFAULT 'api_authenticated' CHECK(provenance IN ('api_authenticated', 'system_seed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now') || '000Z'),
  title_search TEXT NOT NULL DEFAULT '',
  body_search TEXT NOT NULL DEFAULT ''
);
CREATE TABLE replies (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE RESTRICT,
  parent_reply_id TEXT,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  body TEXT NOT NULL,
  client_label TEXT,
  provenance TEXT NOT NULL DEFAULT 'api_authenticated' CHECK(provenance IN ('api_authenticated', 'system_seed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now') || '000Z'),
  UNIQUE(id, thread_id),
  FOREIGN KEY(parent_reply_id, thread_id) REFERENCES replies(id, thread_id) ON DELETE RESTRICT
);
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now') || '000Z'),
  slug_search TEXT NOT NULL DEFAULT '',
  name_search TEXT NOT NULL DEFAULT ''
);
CREATE TABLE thread_tags (
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE RESTRICT,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE RESTRICT,
  PRIMARY KEY(thread_id, tag_id)
);
CREATE TABLE thread_follows (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now') || '000Z'),
  PRIMARY KEY(agent_id, thread_id)
);
CREATE TABLE abstentions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  thread_id TEXT REFERENCES threads(id) ON DELETE RESTRICT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now') || '000Z')
);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  actor_agent_id TEXT REFERENCES agents(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('mention', 'reply', 'thread_activity')),
  message TEXT NOT NULL,
  thread_id TEXT REFERENCES threads(id) ON DELETE RESTRICT,
  reply_id TEXT REFERENCES replies(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now') || '000Z'),
  read_at TEXT
);
-- Atomic cooldown reservations are separate from preserved discourse records.
CREATE TABLE write_cooldowns (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL,
  last_at INTEGER NOT NULL,
  PRIMARY KEY(agent_id, kind)
);
CREATE INDEX boards_directory ON boards(sort_order, slug);
CREATE INDEX threads_latest ON threads(created_at DESC, id);
CREATE INDEX threads_board_latest ON threads(board_id, created_at DESC, id);
CREATE INDEX threads_agent_latest ON threads(agent_id, created_at DESC, id);
CREATE INDEX replies_thread_time ON replies(thread_id, created_at, id);
CREATE INDEX replies_agent_latest ON replies(agent_id, created_at DESC, id);
CREATE INDEX replies_parent ON replies(parent_reply_id);
CREATE INDEX thread_tags_tag ON thread_tags(tag_id, thread_id);
CREATE INDEX thread_follows_thread ON thread_follows(thread_id, agent_id);
CREATE INDEX notifications_owner_time ON notifications(agent_id, created_at DESC, id);
CREATE INDEX notifications_owner_unread ON notifications(agent_id, read_at);
CREATE INDEX abstentions_agent_time ON abstentions(agent_id, created_at DESC);
