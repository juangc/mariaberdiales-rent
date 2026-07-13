import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { config } from './config.mjs';
import { database, ensureInitialAdmin, findUserBySession } from './database.mjs';
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

function requestUser(request) {
  const cookies = parseCookies(request);
  return findUserBySession(cookies[sessionCookieName()]);
}

function requireUser(request) {
  const user = requestUser(request);
  if (!user) throw new HttpError(401, 'Inicia sesión para continuar.');
  return user;
}

function requireAdmin(request) {
  const user = requireUser(request);
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
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

function documentPage(user, searchParams) {
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
  const accessParameters = [];
  if (user.role !== 'admin') {
    accessConditions.push('(documents.visibility = ? OR documents.tenant_id = ?)');
    accessParameters.push('shared', user.id);
  }
  const filterConditions = [...accessConditions];
  const filterParameters = [...accessParameters];
  if (kind) {
    filterConditions.push('documents.kind = ?');
    filterParameters.push(kind);
  }
  if (status) {
    filterConditions.push('documents.status = ?');
    filterParameters.push(status);
  }
  if (utilityType) {
    filterConditions.push('documents.kind = ? AND documents.utility_type = ?');
    filterParameters.push('invoice', utilityType);
  }

  const accessWhere = accessConditions.length ? `WHERE ${accessConditions.join(' AND ')}` : '';
  const filterWhere = filterConditions.length ? `WHERE ${filterConditions.join(' AND ')}` : '';
  const pageSize = 10;
  const countRow = database.prepare(`SELECT COUNT(*) AS total FROM documents ${filterWhere}`)
    .get(...filterParameters);
  const total = Number(countRow.total);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const rows = database.prepare(`
    SELECT documents.*, users.name AS tenant_name
    FROM documents
    LEFT JOIN users ON users.id = documents.tenant_id
    ${filterWhere}
    ORDER BY documents.created_at DESC, documents.id DESC
    LIMIT ? OFFSET ?
  `).all(...filterParameters, pageSize, (page - 1) * pageSize);
  const summaryRow = database.prepare(`
    SELECT
      COUNT(*) AS document_count,
      SUM(CASE WHEN kind = 'invoice' AND status IN ('pending', 'overdue') THEN 1 ELSE 0 END)
        AS pending_invoice_count,
      COALESCE(SUM(CASE
        WHEN kind = 'invoice' AND status IN ('pending', 'overdue') THEN amount_cents
        ELSE 0
      END), 0) AS pending_amount_cents
    FROM documents
    ${accessWhere}
  `).get(...accessParameters);

  return {
    documents: rows.map(publicDocument),
    pagination: { page, pageSize, total, totalPages },
    summary: {
      documentCount: Number(summaryRow.document_count),
      pendingInvoiceCount: Number(summaryRow.pending_invoice_count),
      pendingAmountCents: Number(summaryRow.pending_amount_cents),
    },
  };
}

function publicDocument(row) {
  return {
    id: row.id,
    kind: row.kind,
    utilityType: row.utility_type,
    title: row.title,
    period: row.period,
    amountCents: row.amount_cents,
    dueDate: row.due_date,
    status: row.status,
    visibility: row.visibility,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    originalName: row.original_name,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
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
    database.prepare('SELECT 1').get();
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathname === '/api/login' && request.method === 'POST') {
    assertLoginAllowed(request);
    const body = await readJson(request);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!password || password.length > 128) throw new HttpError(401, 'Correo o contraseña incorrectos.');
    const user = database.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
    if (!user) {
      await hashPassword(password, Buffer.alloc(16, 1));
      throw new HttpError(401, 'Correo o contraseña incorrectos.');
    }
    if (!(await verifyPassword(password, user.password_salt, user.password_hash))) {
      throw new HttpError(401, 'Correo o contraseña incorrectos.');
    }

    clearLoginAttempts(request);
    const token = createSessionToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.sessionDays * 86_400_000);
    database.prepare(`
      INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(digestToken(token), user.id, expiresAt.toISOString(), now.toISOString());
    response.setHeader('Set-Cookie', serializeSessionCookie(token, config.sessionDays * 86_400));
    sendJson(response, 200, { user: publicUser(user) });
    return;
  }

  if (pathname === '/api/logout' && request.method === 'POST') {
    const cookies = parseCookies(request);
    const token = cookies[sessionCookieName()];
    if (token) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digestToken(token));
    response.setHeader('Set-Cookie', serializeSessionCookie('', 0));
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathname === '/api/me' && request.method === 'GET') {
    sendJson(response, 200, { user: publicUser(requireUser(request)) });
    return;
  }

  if (pathname === '/api/documents' && request.method === 'GET') {
    const user = requireUser(request);
    sendJson(response, 200, documentPage(user, searchParams));
    return;
  }

  const fileMatch = pathname.match(/^\/api\/documents\/(\d+)\/file$/);
  if (fileMatch && request.method === 'GET') {
    const user = requireUser(request);
    const row = database.prepare('SELECT * FROM documents WHERE id = ?').get(Number(fileMatch[1]));
    if (!row) throw new HttpError(404, 'Documento no encontrado.');
    if (user.role !== 'admin' && row.visibility !== 'shared' && row.tenant_id !== user.id) {
      throw new HttpError(403, 'No tienes acceso a este documento.');
    }
    const filePath = path.resolve(config.storagePath, row.storage_name);
    if (!filePath.startsWith(`${config.storagePath}${path.sep}`) || !fs.existsSync(filePath)) {
      throw new HttpError(404, 'El archivo ya no está disponible.');
    }
    response.writeHead(200, {
      ...securityHeaders('application/pdf'),
      'Content-Type': 'application/pdf',
      'Content-Length': row.size_bytes,
      'Content-Disposition': contentDisposition(row.original_name),
      'Cache-Control': 'private, no-store',
    });
    fs.createReadStream(filePath).pipe(response);
    return;
  }

  if (pathname === '/api/admin/users' && request.method === 'GET') {
    requireAdmin(request);
    const users = database.prepare(`
      SELECT id, email, name, role, active, created_at AS createdAt
      FROM users ORDER BY role, name
    `).all();
    sendJson(response, 200, { users });
    return;
  }

  if (pathname === '/api/admin/users' && request.method === 'POST') {
    requireAdmin(request);
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
      const result = database.prepare(`
        INSERT INTO users (email, name, password_salt, password_hash, role, active, created_at)
        VALUES (?, ?, ?, ?, 'tenant', 1, ?)
      `).run(email, name, hashed.salt, hashed.hash, new Date().toISOString());
      sendJson(response, 201, { user: { id: Number(result.lastInsertRowid), email, name, role: 'tenant' } });
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw new HttpError(409, 'Ya existe un usuario con ese correo.');
      throw error;
    }
    return;
  }

  const userStatusMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
  if (userStatusMatch && request.method === 'PATCH') {
    const admin = requireAdmin(request);
    const userId = Number(userStatusMatch[1]);
    const body = await readJson(request);
    const active = body.active ? 1 : 0;
    if (userId === admin.id && active === 0) throw new HttpError(400, 'No puedes desactivar tu propia cuenta.');
    const result = database.prepare('UPDATE users SET active = ? WHERE id = ?').run(active, userId);
    if (!result.changes) throw new HttpError(404, 'Usuario no encontrado.');
    if (!active) database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathname === '/api/admin/documents' && request.method === 'POST') {
    requireAdmin(request);
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
      const tenant = database.prepare("SELECT id FROM users WHERE id = ? AND role = 'tenant'").get(tenantId);
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
      const result = database.prepare(`
        INSERT INTO documents (
          kind, utility_type, title, period, amount_cents, due_date, status, visibility, tenant_id,
          storage_name, original_name, mime_type, size_bytes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?)
      `).run(
        kind,
        kind === 'invoice' ? utilityType : null,
        title,
        searchParams.get('period') || null,
        amountCents,
        dueDate,
        status,
        visibility,
        tenantId,
        storageName,
        safeDownloadName(decodeFileName(request.headers['x-file-name'])),
        contents.length,
        new Date().toISOString(),
      );
      sendJson(response, 201, { id: Number(result.lastInsertRowid) });
    } catch (error) {
      fs.unlinkSync(storagePath);
      throw error;
    }
    return;
  }

  const documentMatch = pathname.match(/^\/api\/admin\/documents\/(\d+)$/);
  if (documentMatch && request.method === 'PATCH') {
    requireAdmin(request);
    const documentId = Number(documentMatch[1]);
    const current = database.prepare('SELECT * FROM documents WHERE id = ?').get(documentId);
    if (!current) throw new HttpError(404, 'Documento no encontrado.');
    const body = await readJson(request);
    const has = (field) => Object.prototype.hasOwnProperty.call(body, field);
    const kind = has('kind') ? String(body.kind) : current.kind;
    const utilityType = has('utilityType')
      ? (body.utilityType ? String(body.utilityType) : null)
      : current.utility_type;
    const title = has('title') ? String(body.title || '').trim() : current.title;
    const visibility = has('visibility') ? String(body.visibility) : current.visibility;
    const tenantId = has('tenantId')
      ? parseOptionalInteger(body.tenantId, 'El inquilino')
      : current.tenant_id;
    const status = has('status') ? String(body.status) : current.status;
    const amountCents = has('amountCents')
      ? parseOptionalInteger(body.amountCents, 'El importe')
      : current.amount_cents;
    const period = has('period') ? String(body.period || '').trim() || null : current.period;
    const dueDate = has('dueDate') ? String(body.dueDate || '') || null : current.due_date;

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
      const tenant = database.prepare("SELECT id FROM users WHERE id = ? AND role = 'tenant'").get(tenantId);
      if (!tenant) throw new HttpError(400, 'El inquilino seleccionado no existe.');
    }

    database.prepare(`
      UPDATE documents SET
        kind = ?, utility_type = ?, title = ?, period = ?, amount_cents = ?, due_date = ?,
        status = ?, visibility = ?, tenant_id = ?
      WHERE id = ?
    `).run(
      kind,
      kind === 'invoice' ? utilityType : null,
      title,
      period,
      amountCents,
      dueDate,
      status,
      visibility,
      tenantId,
      documentId,
    );
    sendJson(response, 200, { ok: true });
    return;
  }

  if (documentMatch && request.method === 'DELETE') {
    requireAdmin(request);
    const row = database.prepare('SELECT storage_name FROM documents WHERE id = ?').get(Number(documentMatch[1]));
    if (!row) throw new HttpError(404, 'Documento no encontrado.');
    database.prepare('DELETE FROM documents WHERE id = ?').run(Number(documentMatch[1]));
    const filePath = path.join(config.storagePath, row.storage_name);
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
