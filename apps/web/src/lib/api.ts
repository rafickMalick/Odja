/**
 * Accès à l'API Ojà.
 *
 * Deux contextes, une seule fonction :
 *
 *   · **côté serveur** (composants et actions), les cookies de la requête
 *     entrante sont retransmis à l'API  sans quoi une page rendue sur le
 *     serveur ne saurait pas qui la demande ;
 *   · **côté navigateur**, `credentials: 'include'` suffit.
 *
 * Le front et l'API vivent sur deux ports en développement, deux
 * sous-domaines en production. Dans les deux cas c'est le **même site** au
 * sens des cookies (`localhost`, puis `oja.market`), donc les cookies
 * `SameSite=Lax` circulent. C'est ce qui permet de garder les jetons en
 * `httpOnly` plutôt qu'à portée du premier script injecté.
 */

/* Adresse réelle de l'API : celle qu'appellent le serveur Next et le proxy
   déclaré dans next.config.ts. */
const API_ORIGIN_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

/**
 * Côté navigateur, l'API est appelée **sur le domaine du site** (`/api/v1`),
 * et Next la relaie vers la vraie API (rewrites, next.config.ts).
 *
 * En ligne, le site (`*.vercel.app`) et l'API (`*.onrender.com`) sont deux
 * sites distincts pour le navigateur : il refusait les cookies de session de
 * l'API, posés depuis un site tiers. On voyait son espace cinq secondes, le
 * temps de la réponse de connexion, puis on était renvoyé vers la connexion
 * à la requête suivante. Relayés par le site, les cookies deviennent les
 * siens, et le navigateur les garde.
 */
export const API_BASE_URL = typeof window === 'undefined' ? API_ORIGIN_URL : '/api/v1';
const BASE_URL = API_BASE_URL;

/** Erreur d'API au format RFC 9457, telle que le serveur la renvoie. */
export interface ApiProblem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  traceId?: string;
  errors?: { field: string; message: string }[];
}

export class ApiError extends Error {
  constructor(readonly problem: ApiProblem) {
    super(problem.detail ?? problem.title);
  }

  /** Message à afficher sous un champ de formulaire. */
  fieldError(field: string): string | undefined {
    return this.problem.errors?.find((error) => error.field === field)?.message;
  }

  get isUnauthorized(): boolean {
    return this.problem.status === 401;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Revalidation ISR côté serveur. `0` désactive le cache. */
  revalidate?: number;
  signal?: AbortSignal;
  /**
   * En-tête `Idempotency-Key`. La même clé pour la même intention : rejouée,
   * la requête renvoie la première réponse au lieu de recommencer (voir
   * newIdempotencyKey).
   */
  idempotencyKey?: string;
}

/** Clé d'idempotence aléatoire, une par intention (une commande, un paiement). */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Navigateurs anciens ou contexte non sécurisé : 16 octets aléatoires.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Renouvellement de session.
 *
 * Le jeton d'accès ne vit que 15 minutes ; le jeton de rafraîchissement, lui,
 * plusieurs jours. Sans cette étape, tout espace renvoyait vers la connexion
 * au bout d'un quart d'heure, même en pleine utilisation. Sur un `401`, le
 * navigateur demande donc une nouvelle session puis rejoue la requête, une
 * seule fois.
 *
 * Un seul renouvellement à la fois : une page qui lance cinq requêtes en
 * parallèle recevrait cinq `401`. Cinq rafraîchissements consommeraient le
 * même jeton cinq fois, et l'API, y voyant un rejeu, fermerait toutes les
 * sessions par sécurité.
 */
let pendingRefresh: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  pendingRefresh ??= fetch(`${BASE_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
  })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      pendingRefresh = null;
    });
  return pendingRefresh;
}

/* Les routes d'authentification ne déclenchent jamais de renouvellement : un
   mauvais mot de passe renvoie aussi un 401, et l'échec du renouvellement
   lui-même ne doit pas boucler. */
const NO_REFRESH = /^\/auth\/(login|register|refresh|logout)\b/;

/** Titre de l'erreur de l'API quand l'espace admin exige le second facteur. */
const MFA_REQUIRED_TITLE = 'Double authentification requise';
export const MFA_PAGE = '/double-authentification';

/** L'API refuse l'espace admin faute de double authentification. */
export function isMfaRequired(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.problem.status === 403 &&
    error.problem.title === MFA_REQUIRED_TITLE
  );
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await rawFetch<T>(path, options);
  } catch (error) {
    /* Un admin sans double authentification : chaque écran admin en a
       besoin, on l'emmène l'activer depuis n'importe lequel, et on l'y
       ramène ensuite. */
    if (
      typeof window !== 'undefined' &&
      isMfaRequired(error) &&
      window.location.pathname !== MFA_PAGE
    ) {
      window.location.assign(
        `${MFA_PAGE}?suite=${encodeURIComponent(window.location.pathname)}`,
      );
    }
    if (
      typeof window !== 'undefined' &&
      error instanceof ApiError &&
      error.isUnauthorized &&
      !NO_REFRESH.test(path) &&
      (await refreshSession())
    ) {
      return rawFetch<T>(path, options);
    }
    throw error;
  }
}

async function rawFetch<T>(path: string, options: RequestOptions): Promise<T> {
  const { method = 'GET', body, revalidate, signal, idempotencyKey } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  /* Sur le serveur, `next/headers` n'existe qu'à l'exécution : l'import
     dynamique évite de l'embarquer dans le bundle navigateur. */
  if (typeof window === 'undefined') {
    const { cookies } = await import('next/headers');
    const jar = await cookies();
    const cookieHeader = jar
      .getAll()
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
    if (cookieHeader) headers['Cookie'] = cookieHeader;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {}),
    ...(revalidate !== undefined ? { next: { revalidate } } : { cache: 'no-store' as const }),
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(
      isProblem(payload)
        ? payload
        : { type: 'about:blank', title: 'Erreur', status: response.status },
    );
  }

  return payload as T;
}

function isProblem(value: unknown): value is ApiProblem {
  return typeof value === 'object' && value !== null && 'status' in value && 'title' in value;
}

/**
 * Variante tolérante, pour les données non essentielles au rendu.
 *
 * Une vitrine ne doit pas rendre une page blanche parce qu'un bandeau
 * secondaire n'a pas répondu : elle affiche la page sans le bandeau.
 */
export async function apiFetchOrNull<T>(
  path: string,
  options?: RequestOptions,
): Promise<T | null> {
  try {
    return await apiFetch<T>(path, options);
  } catch {
    return null;
  }
}
