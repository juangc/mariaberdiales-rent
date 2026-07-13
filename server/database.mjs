import { DatabaseSync } from 'node:sqlite';
import { config } from './config.mjs';
import { digestToken, hashPassword } from './security.mjs';

export const database = new DatabaseSync(config.databasePath, {
  enableForeignKeyConstraints: true,
  timeout: 5_000,
});

database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'tenant')),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('invoice', 'contract', 'other')),
    utility_type TEXT CHECK (utility_type IN ('electricity', 'water', 'gas', 'other')),
    title TEXT NOT NULL,
    period TEXT,
    amount_cents INTEGER,
    due_date TEXT,
    status TEXT NOT NULL CHECK (status IN ('information', 'pending', 'paid', 'overdue')),
    visibility TEXT NOT NULL CHECK (visibility IN ('shared', 'private')),
    tenant_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    storage_name TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (
      (visibility = 'shared' AND tenant_id IS NULL)
      OR (visibility = 'private' AND tenant_id IS NOT NULL)
    )
  ) STRICT;

  CREATE INDEX IF NOT EXISTS documents_tenant_idx ON documents(tenant_id);
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
`);

// Migraciones incrementales para instalaciones que ya tienen datos.
const documentColumns = database.prepare('PRAGMA table_info(documents)').all();
if (!documentColumns.some((column) => column.name === 'utility_type')) {
  database.exec(`
    ALTER TABLE documents ADD COLUMN utility_type TEXT
      CHECK (utility_type IN ('electricity', 'water', 'gas', 'other'));
    UPDATE documents SET utility_type = 'other' WHERE kind = 'invoice';
  `);
}

export async function ensureInitialAdmin() {
  const existing = database.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (existing) return;

  if (!config.adminEmail) {
    throw new Error('No existe un administrador. Define ADMIN_EMAIL en el archivo .env.');
  }
  if (!config.adminPassword) {
    throw new Error(
      'No existe un administrador. Define ADMIN_PASSWORD en .env para desarrollo o ADMIN_PASSWORD_FILE en producción.',
    );
  }
  if (config.adminPassword.length < 15) {
    throw new Error('La contraseña inicial del administrador debe tener al menos 15 caracteres.');
  }

  const password = await hashPassword(config.adminPassword);
  database.prepare(`
    INSERT INTO users (email, name, password_salt, password_hash, role, active, created_at)
    VALUES (?, ?, ?, ?, 'admin', 1, ?)
  `).run(
    config.adminEmail,
    config.adminName,
    password.salt,
    password.hash,
    new Date().toISOString(),
  );
  console.log(`Administrador inicial creado: ${config.adminEmail}`);
}

export function findUserBySession(token) {
  if (!token) return null;
  database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
  return database.prepare(`
    SELECT users.id, users.email, users.name, users.role
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.active = 1
  `).get(digestToken(token), new Date().toISOString()) || null;
}
