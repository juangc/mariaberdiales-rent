import crypto from 'node:crypto';

const SCRYPT_OPTIONS = {
  N: 2 ** 17,
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024,
};

export function hashPassword(password, salt = crypto.randomBytes(16)) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) reject(error);
      else resolve({ salt: salt.toString('hex'), hash: derivedKey.toString('hex') });
    });
  });
}

export async function verifyPassword(password, saltHex, expectedHashHex) {
  const { hash } = await hashPassword(password, Buffer.from(saltHex, 'hex'));
  const actual = Buffer.from(hash, 'hex');
  const expected = Buffer.from(expectedHashHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function digestToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
