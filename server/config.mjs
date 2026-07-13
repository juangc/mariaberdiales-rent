import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

function loadLocalEnvironment(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadLocalEnvironment(path.join(root, '.env'));

function readSecret(filePath, fallback = '') {
  if (filePath) {
    try {
      return fs.readFileSync(filePath, 'utf8').trim();
    } catch {
      throw new Error(`No se puede leer el secreto indicado en ADMIN_PASSWORD_FILE: ${filePath}`);
    }
  }
  return fallback;
}

export const config = {
  root,
  port: Number(process.env.PORT || 31234),
  databasePath: path.resolve(process.env.DB_PATH || path.join(root, 'data/app.sqlite')),
  storagePath: path.resolve(process.env.STORAGE_DIR || path.join(root, 'private-storage')),
  production: process.env.NODE_ENV === 'production',
  adminEmail: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  adminName: (process.env.ADMIN_NAME || 'Administrador').trim(),
  adminPassword: readSecret(process.env.ADMIN_PASSWORD_FILE, process.env.ADMIN_PASSWORD),
  sessionDays: Number(process.env.SESSION_DAYS || 7),
  maxPdfBytes: Number(process.env.MAX_PDF_BYTES || 12 * 1024 * 1024),
};

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
fs.mkdirSync(config.storagePath, { recursive: true });
