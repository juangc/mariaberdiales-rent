import path from 'node:path';
import { config } from './config.mjs';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'private, no-store, no-cache, must-revalidate',
    'CDN-Cache-Control': 'no-store',
    'Pragma': 'no-cache',
  });
  response.end(body);
}

export function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf('=');
        return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      }),
  );
}

export function sessionCookieName() {
  return config.production ? '__Host-session' : 'session';
}

export function serializeSessionCookie(token, maxAgeSeconds) {
  const attributes = [
    `${sessionCookieName()}=${encodeURIComponent(token || '')}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (config.production) attributes.push('Secure');
  return attributes.join('; ');
}

export async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'El archivo o petición supera el tamaño permitido.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(request) {
  const body = await readBody(request, 64 * 1024);
  try {
    return JSON.parse(body.toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'El cuerpo JSON no es válido.');
  }
}

function parseOrigin(origin) {
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

export function isAllowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const parsed = parseOrigin(origin);
  return Boolean(parsed) && (parsed.host === request.headers.host || config.corsOrigins.includes(parsed.origin));
}

export function requireSameOrigin(request) {
  if (!isAllowedOrigin(request)) throw new HttpError(403, 'Origen no permitido.');
}

/**
 * Cabeceras CORS para los orígenes declarados en CORS_ORIGINS. Solo hace falta
 * para clientes web alojados en otro dominio (por ejemplo Expo Web o un
 * entorno de desarrollo); las apps nativas no necesitan CORS.
 */
export function corsHeaders(request) {
  const origin = request.headers.origin;
  if (!origin || !config.corsOrigins.length) return {};
  const parsed = parseOrigin(origin);
  if (!parsed || !config.corsOrigins.includes(parsed.origin)) return {};
  return {
    'Access-Control-Allow-Origin': parsed.origin,
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-File-Name',
    'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}

export function safeDownloadName(name) {
  return path.basename(name).replace(/[\r\n"\\]/g, '_').slice(0, 160) || 'documento.pdf';
}

export function contentDisposition(name) {
  const safeName = safeDownloadName(name);
  const asciiName = safeName.normalize('NFKD').replace(/[^\x20-\x7e]/g, '_');
  return `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}
