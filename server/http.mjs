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
    'Cache-Control': 'no-store',
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

export function requireSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'Origen no permitido.');
  }
  if (originHost !== request.headers.host) throw new HttpError(403, 'Origen no permitido.');
}

export function safeDownloadName(name) {
  return path.basename(name).replace(/[\r\n"\\]/g, '_').slice(0, 160) || 'documento.pdf';
}

export function contentDisposition(name) {
  const safeName = safeDownloadName(name);
  const asciiName = safeName.normalize('NFKD').replace(/[^\x20-\x7e]/g, '_');
  return `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}
