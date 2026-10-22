-- D1 candidate migration: validate against the actual Sites D1 binding before deployment.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(issuer, subject)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_flows (
  state_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('identity','google')),
  binding_hash TEXT NOT NULL,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('todo','doing','done')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(id, owner_id)
);
CREATE INDEX IF NOT EXISTS tasks_owner ON tasks(owner_id, created_at);
CREATE TABLE IF NOT EXISTS google_connections (
  owner_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL,
  folder_id TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('google','demo')),
  remote_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(task_id, owner_id) REFERENCES tasks(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS attachments_owner ON attachments(owner_id, task_id);
