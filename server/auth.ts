// Pairing (estate ADR-038): a parent enters the family phrase on the child's device once, and
// the device gets 256 random bits in an HttpOnly cookie; only their hash is stored.
import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const COOKIE = 'unejanku_device';
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 32;
/** A year: the device stays paired until it is unpaired. */
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/** Spaces and case do not matter when a parent types the four words on a phone. */
const normal = (phrase: string) => phrase.trim().toLowerCase().split(/\s+/).join(' ');

/** The `.env` value for a phrase: `scrypt:<salt>:<hash>`, base64url. */
export function hashPhrase(phrase: string, salt = randomBytes(16)): string {
  const hash = scryptSync(normal(phrase), salt, KEY_LENGTH, SCRYPT);
  return `scrypt:${salt.toString('base64url')}:${hash.toString('base64url')}`;
}

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, length: number, options: typeof SCRYPT) => Promise<Buffer>;

/** Off the event loop: a check takes tens of milliseconds and 32 MB. */
export async function phraseMatches(phrase: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hash) throw new Error('FAMILY_PHRASE_HASH is not scrypt:<salt>:<hash>');
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scryptAsync(normal(phrase), Buffer.from(salt, 'base64url'), expected.length, SCRYPT);
  return timingSafeEqual(actual, expected);
}

export const newToken = () => randomBytes(32).toString('base64url');
export const newId = () => randomBytes(8).toString('hex');
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export function deviceCookie(token: string): string {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${String(COOKIE_MAX_AGE)}`;
}

export const clearedCookie = `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0`;

/** The device token from a Cookie header, or null. */
export function cookieToken(header: string | undefined): string | null {
  for (const part of (header ?? '').split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === COOKIE && value && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  }
  return null;
}
