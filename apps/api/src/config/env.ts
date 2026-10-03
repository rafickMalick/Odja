import { z } from 'zod';

/**
 * Configuration validée au démarrage.
 *
 * Le principe : l'application refuse de démarrer plutôt que de tourner à
 * moitié configurée. Une variable manquante se découvre au lancement, pas au
 * premier client qui passe commande.
 */

const intFromEnv = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

/**
 * Booléen lu depuis l'environnement.
 *
 * **Ne jamais utiliser `z.coerce.boolean()` ici** : il applique `Boolean()`,
 * et `Boolean("false")` vaut `true`. Un réglage mis à `false` serait donc
 * activé — ce qui est exactement arrivé à la vérification par SMS, réactivée
 * en silence et bloquant toutes les connexions.
 */
const booleanFromEnv = (fallback: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(fallback)
    .transform((value) => {
      if (typeof value === 'boolean') return value;
      return ['true', '1', 'yes', 'oui', 'on'].includes(value.trim().toLowerCase());
    });

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: intFromEnv(4000),
    WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
    /** Relais devant l'API dont X-Forwarded-For fait foi (voir main.ts). 0 en local. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    /** Domaine partagé par le front et l'API (`oja.aworix.agency`). Absent en local. */
    COOKIE_DOMAIN: z
      .string()
      .trim()
      .regex(/^\.?[a-z0-9-]+(\.[a-z0-9-]+)+$/i, 'COOKIE_DOMAIN doit être un nom de domaine')
      .optional(),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL est obligatoire'),
    REDIS_URL: z.string().min(1).optional(),

    JWT_ACCESS_SECRET: z.string().min(16, 'le secret JWT doit faire au moins 16 caractères'),
    JWT_REFRESH_SECRET: z.string().min(16),
    ARGON2_PEPPER: z.string().min(8),

    // ── Métier (cahier des charges client) ──
    /** Commission Ojà en points de base. 500 = 5 %, AJOUTÉE au prix créateur. */
    PLATFORM_COMMISSION_BPS: intFromEnv(500),
    /** Versement au créateur : 24 h après validation de la réception. */
    PAYOUT_HOLD_HOURS: intFromEnv(24),
    /** Validation automatique si le client ne clique jamais (§ 9-A). */
    AUTO_VALIDATE_HOURS: intFromEnv(72),
    /** Délai de réponse du créateur. Le silence vaut refus (§ 9-D). */
    SUBORDER_ACCEPT_HOURS: intFromEnv(48),
    /** Combien d'heures avant l'échéance on relance l'atelier (LN-06). */
    SUBORDER_REMINDER_LEAD_HOURS: intFromEnv(12),
    PAYMENT_EXPIRY_MINUTES: intFromEnv(30),
    DISTANCE_SINUOSITY_FACTOR: z.coerce.number().min(1).default(1.3),

    PAYMENT_PROVIDER: z.enum(['simulated', 'kadevpay']).default('simulated'),

    /* Ordonnanceur des échéances métier. Actif par défaut : une plateforme qui
       ne valide jamais automatiquement et ne libère jamais un versement est en
       panne silencieuse. On ne le coupe que pour les tests. */
    SCHEDULER_ENABLED: booleanFromEnv(true),

    /* Limitation de débit sur la connexion, les codes et la preuve de
       livraison. Par défaut active : la défaut sûre est celle qui protège. */
    RATE_LIMIT_ENABLED: booleanFromEnv(true),

    /** Vérification du téléphone par SMS. Mise de côté : voir AuthService. */
    REQUIRE_PHONE_VERIFICATION: booleanFromEnv(false),
    MAIL_FROM: z.string().default('Ojà <bonjour@oja.market>'),
    /** Adresse du premier administrateur d'une base neuve. Sans effet dès
        qu'un admin existe : voir AdminBootstrapService. */
    ADMIN_BOOTSTRAP_EMAIL: z.preprocess(
      // Laissée vide sur Render : traitée comme absente, pas comme invalide.
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().email('ADMIN_BOOTSTRAP_EMAIL doit être une adresse e-mail').optional(),
    ),
    SMTP_SECURE: booleanFromEnv(false),
    /** Clé de l'API Brevo. Renseignée, elle remplace SMTP : Render bloque les
        ports SMTP sur ses services gratuits. Voir EmailService. */
    BREVO_API_KEY: z.string().optional(),
    /** Liste Brevo où copier les abonnés à la newsletter. Absente : ils
        restent en base seulement. Voir NewsletterService. */
    BREVO_NEWSLETTER_LIST_ID: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.coerce.number().int().positive().optional(),
    ),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),

    S3_ENDPOINT: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),

    // ── Agrégateur de paiement — dernier lot ──
    KADEVPAY_BASE_URL: z.string().url().optional(),
    KADEVPAY_PUBLIC_KEY: z.string().optional(),
    KADEVPAY_SECRET_KEY: z.string().optional(),
    KADEVPAY_WEBHOOK_SECRET: z.string().optional(),
    KADEVPAY_MODE: z.enum(['test', 'live']).default('test'),
  })
  /**
   * Garde-fou du § 7.7 du cahier : jamais de clé de test en production.
   *
   * Le sens qui compte est celui-ci — une clé `_test_` chargée en production
   * ferait tourner une boutique qui semble encaisser sans jamais rien
   * encaisser. Le contraire (une clé `live` en développement) est vérifié
   * aussi : ce serait pire, on débiterait de vrais clients depuis un poste de
   * développement.
   */
  .superRefine((env, ctx) => {
    if (env.PAYMENT_PROVIDER !== 'kadevpay') return;

    const secret = env.KADEVPAY_SECRET_KEY ?? '';
    const isTestKey = secret.startsWith('kdvs_test_');
    const isLiveKey = secret.startsWith('kdvs_live_');

    if (!secret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['KADEVPAY_SECRET_KEY'],
        message: 'PAYMENT_PROVIDER=kadevpay exige une clé secrète',
      });
      return;
    }

    if (!env.KADEVPAY_PUBLIC_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['KADEVPAY_PUBLIC_KEY'],
        message: 'PAYMENT_PROVIDER=kadevpay exige une clé publique',
      });
    }

    /* Sans ce contrôle, une valeur vide passe la validation Zod (`optional()`
       accepte l'absence, une chaîne vide n'est pas absente) et `getOrThrow`
       ne s'en plaint pas non plus : la vérification de signature calculerait
       alors un HMAC avec une clé vide — silencieusement franchissable par
       quiconque connaît ce défaut. Une faille de sécurité qui démarre sans
       la moindre erreur est la pire à trouver après coup. */
    if (!env.KADEVPAY_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['KADEVPAY_WEBHOOK_SECRET'],
        message:
          'PAYMENT_PROVIDER=kadevpay exige le secret webhook — sans lui, la ' +
          'vérification de signature se ferait avec une clé vide.',
      });
    }

    if (env.NODE_ENV === 'production' && !isLiveKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['KADEVPAY_SECRET_KEY'],
        message:
          'clé de test chargée en production : refus de démarrer. ' +
          'La boutique semblerait encaisser sans jamais rien encaisser.',
      });
    }

    if (env.NODE_ENV !== 'production' && isLiveKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['KADEVPAY_SECRET_KEY'],
        message:
          'clé de production chargée hors production : refus de démarrer. ' +
          'De vrais clients seraient débités depuis cet environnement.',
      });
    }

    if (env.NODE_ENV === 'production' && env.KADEVPAY_MODE !== 'live') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['KADEVPAY_MODE'],
        message: 'KADEVPAY_MODE doit valoir "live" en production',
      });
    }

    void isTestKey;
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  · ${issue.path.join('.') || '(racine)'} — ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration invalide, démarrage refusé :\n${details}`);
  }

  return parsed.data;
}
