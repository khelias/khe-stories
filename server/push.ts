// Web Push without a payload (ADR-002 point 4): a VAPID-signed empty push wakes the service
// worker, which asks GET /api/notices what is new. Nothing is encrypted, so no library.
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import type { Config } from './config.ts';
import type { Fetch } from './outbound.ts';

/** Push services a subscription may point at; anything else is refused, so a paired device
 *  cannot make the service send requests to an address of its choosing. */
const PUSH_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1000) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && PUSH_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
}

/** A new VAPID key pair: the public key as the browser takes it, the private key's scalar. */
export function newVapidKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pub = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x ?? '', 'base64url'), Buffer.from(pub.y ?? '', 'base64url')]);
  return { publicKey: raw.toString('base64url'), privateKey: privateKey.export({ format: 'jwk' }).d ?? '' };
}

/** The Authorization header for one push service: a JWT for its origin, signed ES256. */
export function vapidHeader(endpoint: string, vapid: Config['vapid'], now: number): string {
  const raw = Buffer.from(vapid.publicKey, 'base64url');
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('VAPID_PUBLIC_KEY is not an uncompressed P-256 point');
  const key = createPrivateKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', d: vapid.privateKey, x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') },
  });
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject })}`;
  const signature = sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `vapid t=${unsigned}.${signature}, k=${vapid.publicKey}`;
}

/** One empty push; `gone` when the subscription no longer exists and should be dropped. */
export async function sendPush(endpoint: string, vapid: Config['vapid'], now: number, send: Fetch): Promise<'sent' | 'gone' | 'failed'> {
  try {
    const response = await send(endpoint, {
      method: 'POST',
      headers: { Authorization: vapidHeader(endpoint, vapid, now), TTL: '86400', Urgency: 'normal', 'Content-Length': '0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404 || response.status === 410) return 'gone';
    return response.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
