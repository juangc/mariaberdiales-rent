import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const sqlitePath = path.resolve(process.argv[2] || process.env.SQLITE_PATH || 'data/app.sqlite');

if (!fs.existsSync(sqlitePath)) {
  throw new Error(`No existe la base de datos SQLite: ${sqlitePath}`);
}

const { closeDatabase, prisma } = await import('../server/database.mjs');
const source = new DatabaseSync(sqlitePath, { readOnly: true });

try {
  const targetCounts = await Promise.all([
    prisma.user.count(),
    prisma.session.count(),
    prisma.document.count(),
  ]);
  if (targetCounts.some((total) => total > 0)) {
    throw new Error('La base de datos MySQL de destino no está vacía. Se cancela la migración.');
  }

  const users = source.prepare('SELECT * FROM users ORDER BY id').all();
  const sessions = source.prepare('SELECT * FROM sessions ORDER BY created_at').all();
  const documents = source.prepare('SELECT * FROM documents ORDER BY id').all();

  await prisma.$transaction(async (transaction) => {
    if (users.length) {
      await transaction.user.createMany({
        data: users.map((user) => ({
          id: BigInt(user.id),
          email: user.email,
          name: user.name,
          passwordSalt: user.password_salt,
          passwordHash: user.password_hash,
          role: user.role,
          active: Boolean(user.active),
          createdAt: user.created_at,
        })),
      });
    }

    if (sessions.length) {
      await transaction.session.createMany({
        data: sessions.map((session) => ({
          tokenHash: session.token_hash,
          userId: BigInt(session.user_id),
          expiresAt: session.expires_at,
          createdAt: session.created_at,
        })),
      });
    }

    if (documents.length) {
      await transaction.document.createMany({
        data: documents.map((document) => ({
          id: BigInt(document.id),
          kind: document.kind,
          utilityType: document.utility_type || (document.kind === 'invoice' ? 'other' : null),
          title: document.title,
          period: document.period ?? null,
          amountCents: document.amount_cents === null ? null : BigInt(document.amount_cents),
          dueDate: document.due_date ?? null,
          status: document.status,
          visibility: document.visibility,
          tenantId: document.tenant_id === null ? null : BigInt(document.tenant_id),
          storageName: document.storage_name,
          originalName: document.original_name,
          mimeType: document.mime_type,
          sizeBytes: BigInt(document.size_bytes),
          createdAt: document.created_at,
        })),
      });
    }
  });

  console.log(`Migración completada desde ${sqlitePath}:`);
  console.log(`- ${users.length} usuarios`);
  console.log(`- ${sessions.length} sesiones`);
  console.log(`- ${documents.length} documentos`);
} finally {
  source.close();
  await closeDatabase();
}
