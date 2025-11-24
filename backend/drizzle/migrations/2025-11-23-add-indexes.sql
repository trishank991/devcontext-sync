-- Migration: add indexes to optimize common queries
-- Run with psql or drizzle migration tooling

-- sync_sessions indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sync_sessions_user_id ON sync_sessions(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sync_sessions_device_id ON sync_sessions(device_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sync_sessions_user_device ON sync_sessions(user_id, device_id);

-- projects indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_is_deleted ON projects(is_deleted);

-- snippets indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_snippets_project_id ON snippets(project_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_snippets_user_id ON snippets(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_snippets_content_hash ON snippets(content_hash);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_snippets_project_is_deleted ON snippets(project_id, is_deleted);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_snippets_user_is_deleted ON snippets(user_id, is_deleted);

-- knowledge indexes (including GIN on tags)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_knowledge_project_id ON knowledge(project_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_knowledge_user_id ON knowledge(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_knowledge_content_hash ON knowledge(content_hash);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_knowledge_is_deleted ON knowledge(is_deleted);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_knowledge_tags_gin ON knowledge USING GIN (tags);
