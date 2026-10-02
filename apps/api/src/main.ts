import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { DomainErrorFilter } from './common/domain-error.filter';
import { ProblemFilter } from './common/problem.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    /**
     * Le corps brut est conservé pour toute la surface HTTP.
     *
     * C'est indispensable aux webhooks de paiement : leur signature HMAC se
     * vérifie sur les octets reçus, jamais sur une re-sérialisation JSON — une
     * différence d'espacement ou d'ordre des clés suffirait à la faire échouer.
     * Le module paiement arrive en dernier lot, mais l'option se pose ici, une
     * fois pour toutes.
     */
    rawBody: true,
  });

  // Les valeurs viennent de la configuration validée au démarrage, pas de
  // `process.env` : ce sont les mêmes clés, mais celles-ci ont été vérifiées.
  const config = app.get(ConfigService);
  const port = config.get<number>('API_PORT', 4000);
  const webOrigin = config.get<string>('WEB_ORIGIN', 'http://localhost:3000');

  /* Nombre de relais (proxys) devant l'API dont l'en-tête X-Forwarded-For
     fait foi. Sans ce réglage, l'adresse vue est celle du dernier relais :
     sur Render, la même pour tous les visiteurs, et la limitation de débit
     (connexion, codes) bloquait tout le monde dès qu'un seul insistait.
     En ligne : 2 (le site Vercel qui relaie l'API, puis Render). */
  const proxyHops = config.get<number>('TRUST_PROXY_HOPS', 0);
  if (proxyHops > 0) app.set('trust proxy', proxyHops);

  app.setGlobalPrefix('api/v1');
  app.use(helmet());

  // Le front est une origine distincte et envoie les cookies de session :
  // `credentials` est donc obligatoire, et l'origine ne peut pas être « * ».
  app.enableCors({ origin: webOrigin, credentials: true });

  // Les jetons vivent dans des cookies httpOnly : il faut les lire.
  app.use(cookieParser());

  /* Pas de ValidationPipe global : la validation passe par Zod, avec les
     schémas de `@oja/contracts` que le front utilise aussi. Un seul schéma
     pour les deux côtés, donc aucune divergence possible. */

  /* L'ordre compte : NestJS retient le dernier filtre déclaré qui accepte
     l'exception. Le filtre métier vient donc après le filtre général, pour le
     supplanter sur les erreurs qu'il sait traduire. */
  app.useGlobalFilters(new ProblemFilter(), new DomainErrorFilter());
  app.enableShutdownHooks();

  await app.listen(port);
  new Logger('Bootstrap').log(`API Ojà à l'écoute sur http://localhost:${port}/api/v1`);
}

void bootstrap();
