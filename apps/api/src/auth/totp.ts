import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Codes à usage unique basés sur le temps (TOTP, RFC 6238).
 *
 * Ce que produisent Google Authenticator, Authy ou 1Password : six chiffres
 * qui changent toutes les 30 secondes, calculés à partir d'un secret partagé
 * une fois, à l'activation. Écrit ici plutôt que tiré d'une bibliothèque :
 * l'algorithme tient en vingt lignes, et c'est du code de sécurité qu'on veut
 * pouvoir relire d'un trait.
 */

const PERIOD_SECONDS = 30;
const DIGITS = 6;
/** Un pas d'avance ou de retard toléré : l'horloge du téléphone dérive. */
const DRIFT_STEPS = 1;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error('Secret base32 invalide');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 160 bits, la taille recommandée pour HMAC-SHA1. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function stepAt(timeMs: number): number {
  return Math.floor(timeMs / 1000 / PERIOD_SECONDS);
}

/** Code d'un pas donné (HOTP de la RFC 4226, appliqué au temps). */
export function totpForStep(secretBase32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Vérifie un code et renvoie le pas qu'il désigne, ou `null`.
 *
 * `lastUsedStep` interdit le rejeu : un code déjà accepté, ou plus ancien que
 * le dernier accepté, est refusé même s'il est encore dans sa fenêtre.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  lastUsedStep: number | null,
  nowMs = Date.now(),
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = stepAt(nowMs);
  for (let step = current - DRIFT_STEPS; step <= current + DRIFT_STEPS; step++) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (safeEqual(totpForStep(secretBase32, step), code)) return step;
  }
  return null;
}

/** Lien `otpauth://` : ouvert sur le téléphone, il remplit l'application seule. */
export function otpauthUrl(secretBase32: string, accountLabel: string, issuer = 'Ojà'): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/* ─── Chiffrement du secret en base ───────────────────────────────────────
   La clé est dérivée (HKDF) du poivre des mots de passe, déjà obligatoire et
   stable : pas de nouvelle variable à poser sur chaque environnement. Le
   poivre ne tourne pas — le changer invaliderait aussi tous les mots de
   passe —, la clé non plus. */

function keyFrom(pepper: string): Buffer {
  return Buffer.from(hkdfSync('sha256', pepper, 'oja-mfa', 'totp-secret-v1', 32));
}

/** `v1:iv:tag:chiffré`, en base64url. */
export function encryptSecret(secret: string, pepper: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(pepper), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), encrypted]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join(':');
}

export function decryptSecret(stored: string, pepper: string): string {
  const [version, iv, tag, encrypted] = stored.split(':');
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('Secret MFA illisible');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(pepper), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/* ─── Codes de secours ─────────────────────────────────────────────────── */

/** `ABCD-EFGH-JKLM` : 60 bits, lisible au téléphone, sans 0/O ni 1/I. */
export function generateRecoveryCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)]
    .map((group) => group.join(''))
    .join('-');
}

/** Assez d'entropie pour qu'un hachage rapide suffise : pas besoin d'argon2. */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256')
    .update(code.toUpperCase().replace(/[\s-]/g, ''))
    .digest('hex');
}
