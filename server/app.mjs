import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { config } from './config.mjs';
import { ensureInitialAdmin, findUserBySession, prisma } from './database.mjs';
import {
  HttpError,
  contentDisposition,
  parseCookies,
  readBody,
  readJson,
  requireSameOrigin,
  safeDownloadName,
  sendJson,
  serializeSessionCookie,
  sessionCookieName,
} from './http.mjs';
import { createSessionToken, digestToken, hashPassword, verifyPassword } from './security.mjs';

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
const loginAttempts = new Map();

function securityHeaders(contentType = '') {
  const headers = {
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
  if (contentType.startsWith('text/html')) {
    headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
    headers['CDN-Cache-Control'] = 'no-store';
  }
  return headers;
}

async function requestUser(request) {
  const cookies = parseCookies(request);
  return findUserBySession(cookies[sessionCookieName()]);
}

async function requireUser(request) {
  const user = await requestUser(request);
  if (!user) throw new HttpError(401, 'Inicia sesión para continuar.');
  return user;
}

async function requireAdmin(request) {
  const user = await requireUser(request);
  if (user.role !== 'admin') throw new HttpError(403, 'No tienes permiso para realizar esta acción.');
  return user;
}

function clientKey(request) {
  return String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
}

function assertLoginAllowed(request) {
  const key = clientKey(request);
  const now = Date.now();
  const recent = (loginAttempts.get(key) || []).filter((time) => now - time < 15 * 60_000);
  if (recent.length >= 10) throw new HttpError(429, 'Demasiados intentos. Prueba de nuevo más tarde.');
  recent.push(now);
  loginAttempts.set(key, recent);
}

function clearLoginAttempts(request) {
  loginAttempts.delete(clientKey(request));
}

function publicUser(user) {
  return { id: Number(user.id), email: user.email, name: user.name, role: user.role };
}

async function documentPage(user, searchParams) {
  const requestedPage = Number(searchParams.get('page') || 1);
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
    throw new HttpError(400, 'La página solicitada no es válida.');
  }

  const kind = searchParams.get('kind');
  const status = searchParams.get('status');
  const utilityType = searchParams.get('utilityType');
  if (kind && !['invoice', 'contract', 'other'].includes(kind)) {
    throw new HttpError(400, 'Filtro de documento no válido.');
  }
  if (status && !['information', 'pending', 'paid', 'overdue'].includes(status)) {
    throw new HttpError(400, 'Filtro de estado no válido.');
  }
  if (utilityType && !['electricity', 'water', 'gas', 'other'].includes(utilityType)) {
    throw new HttpError(400, 'Filtro de suministro no válido.');
  }

  const accessConditions = [];
  if (user.role !== 'admin') {
    accessConditions.push({ OR: [{ visibility: 'shared' }, { tenantId: user.id }] });
  }
  const filterConditions = [...accessConditions];
  if (kind) filterConditions.push({ kind });
  if (status) filterConditions.push({ status });
  if (utilityType) {
    filterConditions.push({ kind: 'invoice', utilityType });
  }

  const accessWhere = accessConditions.length ? { AND: accessConditions } : {};
  const filterWhere = filterConditions.length ? { AND: filterConditions } : {};
  const pageSize = 10;
  const total = await prisma.document.count({ where: filterWhere });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const [rows, documentCount, pendingInvoices] = await Promise.all([
    prisma.document.findMany({
      where: filterWhere,
      include: { tenant: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    prisma.document.count({ where: accessWhere }),
    prisma.document.aggregate({
      where: {
        AND: [
          ...accessConditions,
          { kind: 'invoice' },
          { status: { in: ['pending', 'overdue'] } },
        ],
      },
      _count: { _all: true },
      _sum: { amountCents: true },
    }),
  ]);

  return {
    documents: rows.map(publicDocument),
    pagination: { page, pageSize, total, totalPages },
    summary: {
      documentCount,
      pendingInvoiceCount: pendingInvoices._count._all,
      pendingAmountCents: Number(pendingInvoices._sum.amountCents || 0n),
    },
  };
}

function publicDocument(row) {
  return {
    id: Number(row.id),
    kind: row.kind,
    utilityType: row.utilityType,
    title: row.title,
    period: row.period,
    amountCents: row.amountCents === null ? null : Number(row.amountCents),
    dueDate: row.dueDate,
    status: row.status,
    visibility: row.visibility,
    tenantId: row.tenantId === null ? null : Number(row.tenantId),
    tenantName: row.tenant?.name || null,
    originalName: row.originalName,
    sizeBytes: Number(row.sizeBytes),
    createdAt: row.createdAt,
    fileUrl: `/api/documents/${row.id}/file`,
  };
}

function decodeFileName(value) {
  try {
    return decodeURIComponent(String(value || 'documento.pdf'));
  } catch {
    return 'documento.pdf';
  }
}

function parseOptionalInteger(value, field) {
  if (value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new HttpError(400, `${field} no es válido.`);
  return parsed;
}

async function handleApi(request, response, requestUrl) {
  const { pathname, searchParams } = requestUrl;
  if (request.method !== 'GET' && request.method !== 'HEAD') requireSameOrigin(request);

  if (pathname === '/api/health' && request.method === 'GET') {
    await prisma.$queryRaw`SELECT 1`;
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathname === '/api/login' && request.method === 'POST') {
    assertLoginAllowed(request);
    const body = await readJson(request);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!password || password.length > 128) throw new HttpError(401, 'Correo o contraseña incorrectos.');
    const user = await prisma.user.findFirst({ where: { email, active: true } });
    if (!user) {
      await hashPassword(password, Buffer.alloc(16, 1));
      throw new HttpError(401, 'Correo o contraseña incorrectos.');
    }
    if (!(await verifyPassword(password, user.passwordSalt, user.passwordHash))) {
      throw new HttpError(401, 'Correo o contraseña incorrectos.');
    }

    clearLoginAttempts(request);
    const token = createSessionToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.sessionDays * 86_400_000);
    await prisma.session.create({
      data: {
        tokenHash: digestToken(token),
        userId: user.id,
        expiresAt: expiresAt.toISOString(),
        createdAt: now.toISOString(),
      },
    });
    response.setHeader('Set-Cookie', serializeSessionCookie(token, config.sessionDays * 86_400));
    sendJson(response, 200, { user: publicUser(user) });
    return;
  }

  if (pathname === '/api/logout' && request.method === 'POST') {
    const cookies = parseCookies(request);
    const token = cookies[sessionCookieName()];
    if (token) await prisma.session.deleteMany({ where: { tokenHash: digestToken(token) } });
    response.setHeader('Set-Cookie', serializeSessionCookie('', 0));
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathname === '/api/me' && request.method === 'GET') {
    sendJson(response, 200, { user: publicUser(await requireUser(request)) });
    return;
  }

  if (pathname === '/api/documents' && request.method === 'GET') {
    const user = await requireUser(request);
    sendJson(response, 200, await documentPage(user, searchParams));
    return;
  }

  const fileMatch = pathname.match(/^\/api\/documents\/(\d+)\/file$/);
  if (fileMatch && request.method === 'GET') {
    const user = await requireUser(request);
    const row = await prisma.document.findUnique({ where: { id: BigInt(fileMatch[1]) } });
    if (!row) throw new HttpError(404, 'Documento no encontrado.');
    if (user.role !== 'admin' && row.visibility !== 'shared' && row.tenantId !== user.id) {
      throw new HttpError(403, 'No tienes acceso a este documento.');
    }
    const filePath = path.resolve(config.storagePath, row.storageName);
    if (!filePath.startsWith(`${config.storagePath}${path.sep}`) || !fs.existsSync(filePath)) {
      throw new HttpError(404, 'El archivo ya no está disponible.');
    }
    response.writeHead(200, {
      ...securityHeaders('application/pdf'),
      'Content-Type': 'application/pdf',
      'Content-Length': Number(row.sizeBytes),
      'Content-Disposition': contentDisposition(row.originalName),
      'Cache-Control': 'private, no-store',
    });
    fs.createReadStream(filePath).pipe(response);
    return;
  }

  if (pathname === '/api/admin/users' && request.method === 'GET') {
    await requireAdmin(request);
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    sendJson(response, 200, { users: users.map((user) => ({ ...user, id: Number(user.id) })) });
    return;
  }

  if (pathname === '/api/admin/users' && request.method === 'POST') {
    await requireAdmin(request);
    const body = await readJson(request);
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim();
    const password = String(body.password || '');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Introduce un correo válido.');
    if (name.length < 2) throw new HttpError(400, 'Introduce el nombre del inquilino.');
    if (password.length < 15 || password.length > 128) {
      throw new HttpError(400, 'La contraseña debe tener entre 15 y 128 caracteres.');
    }
    const hashed = await hashPassword(password);
    try {
      const user = await prisma.user.create({
        data: {
          email,
          name,
          passwordSalt: hashed.salt,
          passwordHash: hashed.hash,
          role: 'tenant',
          active: true,
          createdAt: new Date().toISOString(),
        },
      });
      sendJson(response, 201, { user: { id: Number(user.id), email, name, role: 'tenant' } });
    } catch (error) {
      if (error.code === 'P2002') throw new HttpError(409, 'Ya existe un usuario con ese correo.');
      throw error;
    }
    return;
  }

  const userStatusMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
  if (userStatusMatch && request.method === 'PATCH') {
    const admin = await requireAdmin(request);
    const userId = BigInt(userStatusMatch[1]);
    const body = await readJson(request);
    const active = body.active ? 1 : 0;
    if (userId === admin.id && active === 0) throw new HttpError(400, 'No puedes desactivar tu propia cuenta.');
    const result = await prisma.user.updateMany({ where: { id: userId }, data: { active: Boolean(active) } });
    if (!result.count) throw new HttpError(404, 'Usuario no encontrado.');
    if (!active) await prisma.session.deleteMany({ where: { userId } });
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathname === '/api/admin/documents' && request.method === 'POST') {
    await requireAdmin(request);
    const kind = searchParams.get('kind');
    const utilityType = searchParams.get('utilityType') || null;
    const title = String(searchParams.get('title') || '').trim();
    const visibility = searchParams.get('visibility') || (kind === 'contract' ? 'private' : 'shared');
    const tenantId = parseOptionalInteger(searchParams.get('tenantId'), 'El inquilino');
    const status = searchParams.get('status') || (kind === 'invoice' ? 'pending' : 'information');
    const amountCents = parseOptionalInteger(searchParams.get('amountCents'), 'El importe');
    if (!['invoice', 'contract', 'other'].includes(kind)) throw new HttpError(400, 'Tipo de documento no válido.');
    if (kind === 'invoice' && !['electricity', 'water', 'gas', 'other'].includes(utilityType)) {
      throw new HttpError(400, 'Selecciona el tipo de suministro de la factura.');
    }
    if (kind !== 'invoice' && utilityType) throw new HttpError(400, 'Solo las facturas pueden tener un tipo de suministro.');
    if (!['information', 'pending', 'paid', 'overdue'].includes(status)) throw new HttpError(400, 'Estado no válido.');
    if (!['shared', 'private'].includes(visibility)) throw new HttpError(400, 'Visibilidad no válida.');
    if (!title || title.length > 120) throw new HttpError(400, 'El título es obligatorio y no puede superar 120 caracteres.');
    if (amountCents !== null && amountCents < 0) throw new HttpError(400, 'El importe no puede ser negativo.');
    const dueDate = searchParams.get('dueDate') || null;
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new HttpError(400, 'La fecha de vencimiento no es válida.');
    if ((visibility === 'private') !== Boolean(tenantId)) {
      throw new HttpError(400, 'Los documentos privados deben asignarse a un inquilino.');
    }
    if (tenantId) {
      const tenant = await prisma.user.findFirst({
        where: { id: BigInt(tenantId), role: 'tenant' },
        select: { id: true },
      });
      if (!tenant) throw new HttpError(400, 'El inquilino seleccionado no existe.');
    }
    if (request.headers['content-type'] !== 'application/pdf') {
      throw new HttpError(415, 'Solo se admiten archivos PDF.');
    }
    const contents = await readBody(request, config.maxPdfBytes);
    if (contents.length < 5 || contents.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new HttpError(415, 'El archivo no parece ser un PDF válido.');
    }
    const storageName = `${crypto.randomUUID()}.pdf`;
    const storagePath = path.join(config.storagePath, storageName);
    fs.writeFileSync(storagePath, contents, { flag: 'wx', mode: 0o600 });
    try {
      const document = await prisma.document.create({
        data: {
          kind,
          utilityType: kind === 'invoice' ? utilityType : null,
          title,
          period: searchParams.get('period') || null,
          amountCents: amountCents === null ? null : BigInt(amountCents),
          dueDate,
          status,
          visibility,
          tenantId: tenantId === null ? null : BigInt(tenantId),
          storageName,
          originalName: safeDownloadName(decodeFileName(request.headers['x-file-name'])),
          mimeType: 'application/pdf',
          sizeBytes: BigInt(contents.length),
          createdAt: new Date().toISOString(),
        },
      });
      sendJson(response, 201, { id: Number(document.id) });
    } catch (error) {
      fs.unlinkSync(storagePath);
      throw error;
    }
    return;
  }

  const documentMatch = pathname.match(/^\/api\/admin\/documents\/(\d+)$/);
  if (documentMatch && request.method === 'PATCH') {
    await requireAdmin(request);
    const documentId = BigInt(documentMatch[1]);
    const current = await prisma.document.findUnique({ where: { id: documentId } });
    if (!current) throw new HttpError(404, 'Documento no encontrado.');
    const body = await readJson(request);
    const has = (field) => Object.prototype.hasOwnProperty.call(body, field);
    const kind = has('kind') ? String(body.kind) : current.kind;
    const utilityType = has('utilityType')
      ? (body.utilityType ? String(body.utilityType) : null)
      : current.utilityType;
    const title = has('title') ? String(body.title || '').trim() : current.title;
    const visibility = has('visibility') ? String(body.visibility) : current.visibility;
    const tenantId = has('tenantId')
      ? parseOptionalInteger(body.tenantId, 'El inquilino')
      : (current.tenantId === null ? null : Number(current.tenantId));
    const status = has('status') ? String(body.status) : current.status;
    const amountCents = has('amountCents')
      ? parseOptionalInteger(body.amountCents, 'El importe')
      : (current.amountCents === null ? null : Number(current.amountCents));
    const period = has('period') ? String(body.period || '').trim() || null : current.period;
    const dueDate = has('dueDate') ? String(body.dueDate || '') || null : current.dueDate;

    if (!['invoice', 'contract', 'other'].includes(kind)) throw new HttpError(400, 'Tipo de documento no válido.');
    if (kind === 'invoice' && !['electricity', 'water', 'gas', 'other'].includes(utilityType)) {
      throw new HttpError(400, 'Selecciona el tipo de suministro de la factura.');
    }
    if (!['information', 'pending', 'paid', 'overdue'].includes(status)) throw new HttpError(400, 'Estado no válido.');
    if (!['shared', 'private'].includes(visibility)) throw new HttpError(400, 'Visibilidad no válida.');
    if (!title || title.length > 120) throw new HttpError(400, 'El título es obligatorio y no puede superar 120 caracteres.');
    if (amountCents !== null && amountCents < 0) throw new HttpError(400, 'El importe no puede ser negativo.');
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new HttpError(400, 'La fecha de vencimiento no es válida.');
    if ((visibility === 'private') !== Boolean(tenantId)) {
      throw new HttpError(400, 'Los documentos privados deben asignarse a un inquilino.');
    }
    if (tenantId) {
      const tenant = await prisma.user.findFirst({
        where: { id: BigInt(tenantId), role: 'tenant' },
        select: { id: true },
      });
      if (!tenant) throw new HttpError(400, 'El inquilino seleccionado no existe.');
    }

    await prisma.document.update({
      where: { id: documentId },
      data: {
        kind,
        utilityType: kind === 'invoice' ? utilityType : null,
        title,
        period,
        amountCents: amountCents === null ? null : BigInt(amountCents),
        dueDate,
        status,
        visibility,
        tenantId: tenantId === null ? null : BigInt(tenantId),
      },
    });
    sendJson(response, 200, { ok: true });
    return;
  }

  if (documentMatch && request.method === 'DELETE') {
    await requireAdmin(request);
    const documentId = BigInt(documentMatch[1]);
    const row = await prisma.document.findUnique({
      where: { id: documentId },
      select: { storageName: true },
    });
    if (!row) throw new HttpError(404, 'Documento no encontrado.');
    await prisma.document.delete({ where: { id: documentId } });
    const filePath = path.join(config.storagePath, row.storageName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    sendJson(response, 200, { ok: true });
    return;
  }

  throw new HttpError(404, 'Ruta de API no encontrada.');
}

function staticPath(pathname) {
  if (pathname === '/') return path.join(config.root, 'index.html');
  if (pathname === '/portal' || pathname === '/acceso') return path.join(config.root, 'portal.html');
  if (pathname.startsWith('/assets/')) {
    const assetsRoot = path.join(config.root, 'assets');
    const candidate = path.resolve(config.root, `.${pathname}`);
    if (candidate.startsWith(`${assetsRoot}${path.sep}`)) return candidate;
  }
  return null;
}

function serveStatic(response, pathname) {
  const filePath = staticPath(pathname);
  if (!filePath || !filePath.startsWith(config.root) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new HttpError(404, 'Página no encontrada.');
  }
  const contentType = mimeTypes[path.extname(filePath)] || 'application/octet-stream';
  const portalAsset = pathname === '/assets/portal.js' || pathname === '/assets/tailwind.css';
  response.writeHead(200, {
    ...securityHeaders(contentType),
    ...(portalAsset ? {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'CDN-Cache-Control': 'no-store',
    } : {}),
    'Content-Type': contentType,
    'Content-Length': fs.statSync(filePath).size,
  });
  fs.createReadStream(filePath).pipe(response);
}

await ensureInitialAdmin();

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (requestUrl.pathname.startsWith('/api/')) await handleApi(request, response, requestUrl);
    else serveStatic(response, requestUrl.pathname);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    if (!response.headersSent) {
      if (String(request.url).startsWith('/api/')) sendJson(response, status, { error: status === 500 ? 'Error interno del servidor.' : error.message });
      else response.writeHead(status, { ...securityHeaders('text/plain'), 'Content-Type': 'text/plain; charset=utf-8' }).end(error.message);
    } else response.destroy();
  }
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`Portal disponible en http://0.0.0.0:${config.port}`);
});
