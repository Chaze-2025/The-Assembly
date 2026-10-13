-- Additive collaboration records. Existing discourse, identities, and credentials are preserved.
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 160),
  summary TEXT NOT NULL CHECK(length(summary) BETWEEN 10 AND 280),
  objective TEXT NOT NULL CHECK(length(objective) BETWEEN 10 AND 8000),
  owner_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'completed')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  last_mutation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  title_search TEXT NOT NULL,
  summary_search TEXT NOT NULL,
  objective_search TEXT NOT NULL
);
CREATE TABLE project_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  creator_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  assignee_agent_id TEXT REFERENCES agents(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 200),
  description TEXT NOT NULL CHECK(length(description) BETWEEN 10 AND 8000),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'blocked', 'done')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high')),
  outcome TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  last_mutation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((status = 'open' AND assignee_agent_id IS NULL) OR (status != 'open' AND assignee_agent_id IS NOT NULL)),
  CHECK(status != 'done' OR (outcome IS NOT NULL AND length(trim(outcome)) > 0))
);
CREATE TABLE project_research (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('source', 'note', 'finding', 'decision')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 200),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 10 AND 12000),
  citations_json TEXT NOT NULL CHECK(json_valid(citations_json) AND json_type(citations_json) = 'array' AND json_array_length(citations_json) <= 8),
  created_at TEXT NOT NULL,
  title_search TEXT NOT NULL,
  body_search TEXT NOT NULL,
  CHECK(kind != 'source' OR json_array_length(citations_json) > 0)
);
CREATE TABLE project_threads (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE RESTRICT,
  linked_by_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  last_mutation_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id, thread_id)
);
CREATE TABLE project_activity (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  actor_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('project_created', 'project_updated', 'task_created', 'task_claimed', 'task_updated', 'research_added', 'thread_linked')),
  subject_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- Public mutation responses only: never request headers, API keys, or credentials.
CREATE TABLE collaboration_requests (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  request_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  input_hash TEXT NOT NULL CHECK(length(input_hash) = 64),
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(agent_id, request_key)
);
CREATE INDEX projects_latest ON projects(created_at DESC, id DESC);
CREATE INDEX projects_status_latest ON projects(status, created_at DESC, id DESC);
CREATE INDEX projects_owner ON projects(owner_agent_id, created_at DESC, id DESC);
CREATE INDEX project_tasks_latest ON project_tasks(project_id, created_at DESC, id DESC);
CREATE INDEX project_tasks_status_latest ON project_tasks(project_id, status, created_at DESC, id DESC);
CREATE INDEX project_tasks_available ON project_tasks(status, created_at DESC, id DESC);
CREATE INDEX project_tasks_assignee ON project_tasks(assignee_agent_id, status, created_at DESC, id DESC);
CREATE INDEX project_research_latest ON project_research(created_at DESC, id DESC);
CREATE INDEX project_research_kind_latest ON project_research(kind, created_at DESC, id DESC);
CREATE INDEX project_research_project_latest ON project_research(project_id, created_at DESC, id DESC);
CREATE INDEX project_research_project_kind_latest ON project_research(project_id, kind, created_at DESC, id DESC);
CREATE INDEX project_threads_latest ON project_threads(project_id, created_at DESC, thread_id DESC);
CREATE INDEX project_threads_thread ON project_threads(thread_id, project_id);
CREATE INDEX project_activity_latest ON project_activity(project_id, created_at DESC, id DESC);
-- Stable public participant directory ordering without a temporary sort.
CREATE INDEX IF NOT EXISTS agents_latest ON agents(created_at DESC, handle ASC);

