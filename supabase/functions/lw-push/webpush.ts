// Minimal Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) using Web Crypto only.
// Runs in Supabase Edge Functions (Deno) and in Node 20+ (for tests).
const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;

export function b64u(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(s: string): Uint8Array {
  const t = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  let n = 0; for (const p of parts) n += p.length;
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, data));
}
// HKDF with a single expand block (all lengths used here are <= 32).
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);
  const t = await hmac(prk, concat(info, new Uint8Array([1])));
  return t.slice(0, len);
}
function jwkFromRaw(pub: Uint8Array, d?: Uint8Array): JsonWebKey {
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true };
  if (d) jwk.d = b64u(d);
  return jwk;
}

export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const raw = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
  const jwk = await subtle.exportKey('jwk', kp.privateKey) as JsonWebKey;
  return { publicKey: b64u(raw), privateKey: String(jwk.d) };
}

export async function vapidJwt(audience: string, subject: string, publicKey: string, privateKey: string, ttlSec = 12 * 3600): Promise<string> {
  const key = await subtle.importKey('jwk', jwkFromRaw(unb64u(publicKey), unb64u(privateKey)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + ttlSec, sub: subject })));
  const sig = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body)));
  return head + '.' + body + '.' + b64u(sig);
}

// Encrypt one push message (single record, RFC 8291). `fixed` is only for tests.
export async function encryptPayload(payload: Uint8Array, uaPublicB64: string, authB64: string,
  fixed?: { salt: Uint8Array; asPublic: Uint8Array; asPrivate: Uint8Array }): Promise<Uint8Array> {
  const uaPublic = unb64u(uaPublicB64), authSecret = unb64u(authB64);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('bad subscription keys');
  let asPublic: Uint8Array, asPriv: CryptoKey;
  if (fixed) {
    asPublic = fixed.asPublic;
    asPriv = await subtle.importKey('jwk', jwkFromRaw(fixed.asPublic, fixed.asPrivate), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } else {
    const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
    asPublic = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
    asPriv = kp.privateKey;
  }
  const salt = fixed ? fixed.salt : globalThis.crypto.getRandomValues(new Uint8Array(16));
  const uaKey = await subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPriv, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

export type Sub = { endpoint: string; p256dh: string; auth: string };
export async function sendPush(sub: Sub, data: unknown, vapid: { publicKey: string; privateKey: string; subject: string }, ttl = 86400): Promise<number> {
  const url = new URL(sub.endpoint);
  const jwt = await vapidJwt(url.origin, vapid.subject, vapid.publicKey, vapid.privateKey);
  const body = await encryptPayload(enc.encode(JSON.stringify(data)), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'TTL': String(ttl), 'Urgency': 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      'Authorization': 'vapid t=' + jwt + ', k=' + vapid.publicKey
    },
    body
  });
  try { await res.arrayBuffer(); } catch (_e) { /* ignore */ }
  return res.status;
}
