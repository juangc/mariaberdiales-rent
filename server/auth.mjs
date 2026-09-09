import crypto from 'node:crypto';
import { config } from './config.mjs';
import { findUserBySession, prisma } from './database.mjs';
import { HttpError, parseCookies, sessionCookieName } from './http.mjs';
import { createSessionToken, digestToken } from './security.mjs';

// Clave usada para firmar los enlaces temporales de descarga. Si no se define
// DOWNLOAD_LINK_SECRET se genera una por proceso: los enlaces dejan de ser
// válidos al reiniciar la aplicación o si hay varias instancias.
const downloadLinkSecret = config.downloadLinkSecret || crypto.randomBytes(32).toString('hex');
if (!config.downloadLinkSecret && config.production) {
  console.warn('DOWNLOAD_LINK_SECRET no está definido: los enlaces de descarga se invalidan en cada reinicio.');
}

export function readBearerToken(request) {
  const header = String(request.headers.authorization || '');
  const match = header.match(/^Bearer\s+([A-Za-z0-9_-]{20,128})$/);
  return match ? match[1] : null;
}

/**
 * Identifica al usuario de la petición. Acepta dos mecanismos:
 * - Cookie de sesión (portal web).
 * - Cabecera `Authorization: Bearer <token>` (app móvil u otros clientes).
 * Devuelve `{ user, token, method }` o `null` si no hay sesión válida.
 */
export async function authenticate(request) {
  const bearer = readBearerToken(request);
  if (bearer) {
    const user = await findUserBySession(bearer);
    return user ? { user, token: bearer, method: 'bearer' } : null;
  }
  const cookies = parseCookies(request);
  const cookieToken = cookies[sessionCookieName()];
  if (!cookieToken) return null;
  const user = await findUserBySession(cookieToken);
  return user ? { user, token: cookieToken, method: 'cookie' } : null;
}

export async function createSession(userId, days) {
  const token = createSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + days * 86_400_000);
  await prisma.session.create({
    data: {
      tokenHash: digestToken(token),
      userId,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
    },
  });
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function revokeSession(token) {
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: digestToken(token) } });
}

function signDownloadPayload(payload) {
  return crypto.createHmac('sha256', downloadLinkSecret).update(payload).digest('base64url');
}

/**
 * Genera un token firmado y de corta duración que permite descargar un
 * documento concreto sin cabeceras, por ejemplo desde un visor de PDF o el
 * navegador del sistema en la app móvil.
 */
export function createDownloadToken(documentId, userId) {
  const expires = Math.floor(Date.now() / 1000) + config.downloadLinkSeconds;
  const payload = `${documentId}.${userId}.${expires}`;
  return { token: `${payload}.${signDownloadPayload(payload)}`, expiresAt: new Date(expires * 1000).toISOString() };
}

export function verifyDownloadToken(token, documentId) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4) throw new HttpError(403, 'El enlace de descarga no es válido.');
  const [tokenDocumentId, userId, expires, signature] = parts;
  const payload = `${tokenDocumentId}.${userId}.${expires}`;
  const expected = Buffer.from(signDownloadPayload(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new HttpError(403, 'El enlace de descarga no es válido.');
  }
  if (tokenDocumentId !== String(documentId)) throw new HttpError(403, 'El enlace de descarga no es válido.');
  if (Number(expires) * 1000 < Date.now()) throw new HttpError(403, 'El enlace de descarga ha caducado.');
  return { userId: BigInt(userId) };
}
