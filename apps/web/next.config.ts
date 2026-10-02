import type { NextConfig } from "next";

/* Adresse réelle de l'API, figée au build (variable déjà renseignée sur
   Vercel). Sans barre finale, pour composer proprement la destination. */
const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1").replace(
  /\/+$/,
  "",
);

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * Sortie autonome, pour l'image Docker.
   *
   * Next trace les modules réellement atteints et n'embarque qu'eux. Sans
   * cela, l'image de production traîne l'intégralité de `node_modules` du
   * monorepo  Prisma, NestJS, le SDK AWS  pour servir des pages qui n'en
   * utilisent rien.
   */
  output: "standalone",

  /* Le monorepo vit au-dessus de apps/web : sans cette racine, le traçage
     s'arrête au workspace et laisse de côté les paquets partagés. */
  outputFileTracingRoot: process.cwd().replace(/[/\\]apps[/\\]web$/, ""),

  /**
   * Le navigateur appelle l'API sur le domaine du site, Next la relaie.
   *
   * Site et API vivent sur deux domaines distincts (Vercel, Render) : le
   * navigateur refuse alors les cookies de session posés par l'API, comme
   * ceux de n'importe quel site tiers. Relayés ici, ils appartiennent au
   * site. Voir `API_BASE_URL` dans src/lib/api.ts.
   */
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
