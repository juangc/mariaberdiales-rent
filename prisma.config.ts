import 'dotenv/config';
import fs from 'node:fs';
import { defineConfig } from 'prisma/config';

function readSecret(filePath: string | undefined, fallback = '') {
  if (!filePath) return fallback;
  return fs.readFileSync(filePath, 'utf8').trim();
}

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const user = encodeURIComponent(process.env.MYSQL_USER || 'maria_berdiales');
  const password = encodeURIComponent(
    readSecret(process.env.MYSQL_PASSWORD_FILE, process.env.MYSQL_PASSWORD),
  );
  const host = process.env.MYSQL_HOST || '127.0.0.1';
  const port = process.env.MYSQL_PORT || '3306';
  const database = encodeURIComponent(process.env.MYSQL_DATABASE || 'maria_berdiales');
  return `mysql://${user}:${password}@${host}:${port}/${database}`;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl(),
  },
});
