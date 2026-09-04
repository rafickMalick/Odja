import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * Sortie autonome, pour l'image Docker.
   *
   * Next trace les modules réellement atteints et n'embarque qu'eux. Sans
   * cela, l'image de production traîne l'intégralité de `node_modules` du
   * monorepo — Prisma, NestJS, le SDK AWS — pour servir des pages qui n'en
   * utilisent rien.
   */
  output: "standalone",

  /* Le monorepo vit au-dessus de apps/web : sans cette racine, le traçage
     s'arrête au workspace et laisse de côté les paquets partagés. */
  outputFileTracingRoot: process.cwd().replace(/[/\\]apps[/\\]web$/, ""),
};

export default nextConfig;
