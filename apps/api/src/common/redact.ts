/**
 * Masquage des secrets (cahier § 11, backlog L0-30).
 *
 * Ni mot de passe, ni code à usage unique, ni clé, ni jeton, ni numéro de
 * carte ne doit atteindre un journal ou le journal d'audit. On ne compte pas
 * sur la vigilance de chaque appelant : tout passe par ici, au niveau du
 * journaliseur et de l'audit automatique.
 *
 * Deux filets :
 *
 *   · **par nom de champ** dans les objets (`password`, `token`, `iban`…),
 *     quelle que soit la profondeur ;
 *   · **par motif** dans le texte libre : jetons JWT, en-têtes `Bearer`,
 *     clés Brevo et Kadev Pay, `password=…` dans une chaîne, adresses e-mail
 *     (réduites à leurs deux premières lettres, comme `maskEmail`).
 */

export const REDACTED = '[masqué]';

/** Noms de champs dont la valeur n'est jamais écrite, comparés sans casse ni séparateurs. */
const SENSITIVE_KEYS = new Set(
  [
    'password',
    'currentpassword',
    'newpassword',
    'passwordhash',
    'token',
    'accesstoken',
    'refreshtoken',
    'idtoken',
    'authorization',
    'cookie',
    'secret',
    'clientsecret',
    'mfasecret',
    'otp',
    'pin',
    'challenge',
    'recoverycodes',
    'apikey',
    'privatekey',
    'iban',
    'accountnumber',
    'cardnumber',
    'pan',
    'cvv',
    'cvc',
  ].map(normalizeKey),
);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEYS.has(normalized) || normalized.endsWith('secret') || normalized.endsWith('token');
}

const TEXT_PATTERNS: [RegExp, (match: string, ...groups: string[]) => string][] = [
  // Jetons JWT : trois segments base64url, le premier commence toujours par eyJ.
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, () => REDACTED],
  // En-tête d'autorisation.
  [/\bBearer\s+[\w.~+/-]+=*/gi, () => `Bearer ${REDACTED}`],
  // Clés de fournisseurs : Brevo, Kadev Pay, et les formes génériques sk_/pk_.
  [/\bxkeysib-[\w-]+/g, () => REDACTED],
  [/\bkdv[sp]_(?:test|live)_[\w-]+/g, () => REDACTED],
  [/\b(?:sk|rk)_(?:test|live)_[\w-]+/g, () => REDACTED],
  // password=…, "token": "…", secret: … dans une chaîne.
  [
    /\b(password|passwd|pwd|secret|token|api[_-]?key|otp)(["']?\s*[:=]\s*["']?)([^\s"',;&]+)/gi,
    (_match, name: string, separator: string) => `${name}${separator}${REDACTED}`,
  ],
  // Adresses e-mail : deux premières lettres et le domaine, comme maskEmail.
  [
    /\b([A-Za-z0-9._%+-]{1,64})@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,
    (_match, local: string, domain: string) =>
      `${local.slice(0, 2)}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`,
  ],
];

/** Masque les secrets reconnaissables dans un texte libre. */
export function redactText(text: string): string {
  return TEXT_PATTERNS.reduce(
    (current, [pattern, replace]) => current.replace(pattern, replace as never),
    text,
  );
}

/**
 * Copie d'une valeur, secrets masqués. Ne modifie jamais l'original — c'est
 * le corps d'une requête encore en cours de traitement.
 */
export function redactValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 8) return '[trop profond]';
  if (seen.has(value)) return '[circulaire]';
  seen.add(value);

  if (value instanceof Error) {
    const copy = new Error(redactText(value.message));
    copy.name = value.name;
    if (value.stack) copy.stack = redactText(value.stack);
    return copy;
  }
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1, seen));

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      isSensitiveKey(key) && item !== null && item !== undefined
        ? REDACTED
        : redactValue(item, depth + 1, seen),
    ]),
  );
}
