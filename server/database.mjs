import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';
import { config } from './config.mjs';
import { digestToken, hashPassword } from './security.mjs';

const adapter = new PrismaMariaDb({
  host: config.mysqlHost,
  port: config.mysqlPort,
  user: config.mysqlUser,
  password: config.mysqlPassword,
  database: config.mysqlDatabase,
  connectionLimit: config.mysqlConnectionLimit,
});

export const prisma = new PrismaClient({ adapter });

export async function closeDatabase() {
  await prisma.$disconnect();
}

export async function ensureInitialAdmin() {
  const existing = await prisma.user.findFirst({
    where: { role: 'admin' },
    select: { id: true },
  });
  if (existing) return;

  if (!config.adminEmail) {
    throw new Error('No existe un administrador. Define ADMIN_EMAIL en las variables de entorno.');
  }
  if (!config.adminPassword) {
    throw new Error(
      'No existe un administrador. Define ADMIN_PASSWORD o ADMIN_PASSWORD_FILE en producción.',
    );
  }
  if (config.adminPassword.length < 15) {
    throw new Error('La contraseña inicial del administrador debe tener al menos 15 caracteres.');
  }

  const password = await hashPassword(config.adminPassword);
  await prisma.user.create({
    data: {
      email: config.adminEmail,
      name: config.adminName,
      passwordSalt: password.salt,
      passwordHash: password.hash,
      role: 'admin',
      active: true,
      createdAt: new Date().toISOString(),
    },
  });
  console.log(`Administrador inicial creado: ${config.adminEmail}`);
}

export async function findUserBySession(token) {
  if (!token) return null;
  const now = new Date().toISOString();
  await prisma.session.deleteMany({ where: { expiresAt: { lte: now } } });
  const session = await prisma.session.findFirst({
    where: {
      tokenHash: digestToken(token),
      expiresAt: { gt: now },
      user: { active: true },
    },
    select: {
      user: { select: { id: true, email: true, name: true, role: true } },
    },
  });
  return session?.user || null;
}
