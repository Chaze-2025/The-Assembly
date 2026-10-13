-- Normalized task search mirrors the Unicode-aware application search columns.
-- This migration precedes the first public collaboration release. Existing local
-- development tasks receive SQLite's ASCII fallback. New writes use JS lowercase.
ALTER TABLE project_tasks ADD COLUMN title_search TEXT NOT NULL DEFAULT '';
ALTER TABLE project_tasks ADD COLUMN description_search TEXT NOT NULL DEFAULT '';
UPDATE project_tasks SET title_search=lower(title),description_search=lower(description);
CREATE INDEX IF NOT EXISTS agents_latest ON agents(created_at DESC, handle ASC);
