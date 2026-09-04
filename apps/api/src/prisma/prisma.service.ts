import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@oja/db';

/**
 * Accès à la base. Aucun module n'instancie son propre client : un pool par
 * module épuiserait les connexions Postgres bien avant la charge réelle.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Base de données connectée');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
