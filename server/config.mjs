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
      throw new Error(`No se puede leer el secreto indicado: ${filePath}`);
    }
  }
  return fallback;
}

function mysqlConfiguration() {
  if (!process.env.DATABASE_URL) {
    return {
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: Number(process.env.MYSQL_PORT || 3306),
      database: process.env.MYSQL_DATABASE || 'maria_berdiales',
      user: process.env.MYSQL_USER || 'maria_berdiales',
      password: readSecret(process.env.MYSQL_PASSWORD_FILE, process.env.MYSQL_PASSWORD),
    };
  }

  const connection = new URL(process.env.DATABASE_URL);
  if (!['mysql:', 'mariadb:'].includes(connection.protocol)) {
    throw new Error('DATABASE_URL debe usar el protocolo mysql:// o mariadb://.');
  }
  return {
    host: connection.hostname,
    port: Number(connection.port || 3306),
    database: decodeURIComponent(connection.pathname.replace(/^\//, '')),
    user: decodeURIComponent(connection.username),
    password: decodeURIComponent(connection.password),
  };
}

function parseOrigins(value) {
  return String(value || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean)
    .map((origin) => {
      try {
        return new URL(origin).origin;
      } catch {
        throw new Error(`CORS_ORIGINS contiene un origen no válido: ${origin}`);
      }
    });
}

const mysql = mysqlConfiguration();

export const config = {
  root,
  port: Number(process.env.PORT || 31234),
  storagePath: path.resolve(process.env.STORAGE_DIR || path.join(root, 'private-storage')),
  production: process.env.NODE_ENV === 'production',
  mysqlHost: mysql.host,
  mysqlPort: mysql.port,
  mysqlDatabase: mysql.database,
  mysqlUser: mysql.user,
  mysqlPassword: mysql.password,
  mysqlConnectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  adminEmail: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  adminName: (process.env.ADMIN_NAME || 'Administrador').trim(),
  adminPassword: readSecret(process.env.ADMIN_PASSWORD_FILE, process.env.ADMIN_PASSWORD),
  wifiRecommendedSsid: (process.env.WIFI_RECOMMENDED_SSID || 'MOVISTAR_PLUS_3050').trim(),
  wifiSecondarySsid: (process.env.WIFI_SECONDARY_SSID || 'MOVISTAR_3050').trim(),
  wifiPassword: readSecret(process.env.WIFI_PASSWORD_FILE, process.env.WIFI_PASSWORD),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, ''),
  mailFrom: (process.env.MAIL_FROM || process.env.ADMIN_EMAIL || '').trim(),
  sendmailPath: (process.env.SENDMAIL_PATH || '/usr/sbin/sendmail').trim(),
  smtpHost: (process.env.SMTP_HOST || '').trim(),
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpUser: (process.env.SMTP_USER || '').trim(),
  smtpPassword: readSecret(process.env.SMTP_PASSWORD_FILE, process.env.SMTP_PASSWORD),
  smtpSecure: ['1', 'true', 'yes'].includes(String(process.env.SMTP_SECURE || '').toLowerCase()),
  sessionDays: Number(process.env.SESSION_DAYS || 7),
  apiTokenDays: Number(process.env.API_TOKEN_DAYS || 30),
  downloadLinkSeconds: Number(process.env.DOWNLOAD_LINK_SECONDS || 300),
  downloadLinkSecret: readSecret(process.env.DOWNLOAD_LINK_SECRET_FILE, process.env.DOWNLOAD_LINK_SECRET),
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS),
  maxPdfBytes: Number(process.env.MAX_PDF_BYTES || 12 * 1024 * 1024),
};

fs.mkdirSync(config.storagePath, { recursive: true });
