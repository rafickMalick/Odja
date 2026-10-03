import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { CatalogModule } from './catalog/catalog.module';
import { CheckoutModule } from './checkout/checkout.module';
import { validateEnv } from './config/env';
import { AuditInterceptor } from './common/audit.interceptor';
import { RateLimitGuard } from './common/rate-limit.guard';
import { HealthController } from './health/health.controller';
import { MakerModule } from './makers/maker.module';
import { AdminModule } from './admin/admin.module';
import { DisputeModule } from './disputes/dispute.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { LogisticsModule } from './logistics/logistics.module';
import { NewsletterModule } from './newsletter/newsletter.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { SupportModule } from './support/support.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Un seul .env à la racine du monorepo : deux fichiers finissent
      // toujours par diverger.
      envFilePath: ['../../.env'],
      validate: validateEnv,
    }),
    PrismaModule,
    StorageModule,
    NotificationsModule,
    AuthModule,
    MakerModule,
    CatalogModule,
    CheckoutModule,
    OrdersModule,
    LogisticsModule,
    DisputeModule,
    SupportModule,
    NewsletterModule,
    AdminModule,
    SchedulerModule,
  ],
  controllers: [HealthController],
  providers: [
    /* Les deux gardes sont GLOBAUX : toute route est fermée et réservée par
       défaut. L'ouverture passe par @Public(), la restriction par @Roles().
       L'inverse — protéger route par route — laisse fuir la première qu'on
       oublie, et on ne s'en aperçoit qu'après. L'ordre compte : on authentifie
       avant de contrôler le profil. */
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    /* La limitation de débit vient après l'authentification : elle compte par
       utilisateur quand il y en a un, par adresse sinon. Comptée avant, deux
       collègues derrière le même NAT se bloqueraient mutuellement. */
    { provide: APP_GUARD, useClass: RateLimitGuard },
    /* Toute action d'administration réussie est écrite au journal d'audit,
       sans que le service ait à y penser (L0-31). */
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
