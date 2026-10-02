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

const BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

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

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await rawFetch<T>(path, options);
  } catch (error) {
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
  const { method = 'GET', body, revalidate, signal } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

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
