import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { zodBody } from '../common/zod.pipe';
import { PaymentService } from '../payments/payment.service';
import { SubOrderService } from './sub-order.service';
import { ValidationService } from './validation.service';

const rejectSchema = z.object({
  reason: z.string().trim().min(4, 'Indiquez brièvement pourquoi').max(500),
});

/** Espace créateur : les commandes qui lui reviennent. */
@Controller('maker/orders')
@Roles('MAKER')
export class MakerOrdersController {
  constructor(private readonly subOrders: SubOrderService) {}

  /** Le cahier client demande deux onglets : en cours, et historique. */
  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query('scope') scope?: string) {
    return this.subOrders.listForMaker(user.id, scope === 'past' ? 'past' : 'current');
  }

  @Post(':reference/accept')
  async accept(@CurrentUser() user: AuthenticatedUser, @Param('reference') reference: string) {
    return this.subOrders.accept(user.id, reference);
  }

  @Post(':reference/reject')
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
    @Body(zodBody(rejectSchema)) input: { reason: string },
  ) {
    return this.subOrders.reject(user.id, reference, input.reason);
  }

  @Post(':reference/ready')
  async ready(@CurrentUser() user: AuthenticatedUser, @Param('reference') reference: string) {
    return this.subOrders.markReady(user.id, reference);
  }
}

/**
 * Paiement simulé.
 *
 * Réservé à l'administration et refusé en production : c'est le levier qui
 * permet de dérouler tout le parcours avant que l'agrégateur ne soit branché.
 */
@Controller('admin/payments')
@Roles('ADMIN')
export class PaymentAdminController {
  constructor(private readonly payments: PaymentService) {}

  @Post('simulate/:orderReference')
  async simulate(@Param('orderReference') orderReference: string) {
    return this.payments.simulatePayment(orderReference);
  }

  /** Tâches de maintenance, en attendant l'ordonnanceur. */
  @Post('expire-stale')
  async expireStale(): Promise<{ expired: number }> {
    return { expired: await this.payments.expireStalePayments() };
  }
}

@Controller('admin/orders')
@Roles('ADMIN')
export class OrdersAdminController {
  constructor(private readonly subOrders: SubOrderService) {}

  /** Refuse les sous-commandes restées sans réponse : le silence vaut refus. */
  @Post('expire-unanswered')
  async expireUnanswered(): Promise<{ rejected: number }> {
    return { rejected: await this.subOrders.expireUnanswered() };
  }

  /** Relance les ateliers dont le délai de réponse approche (LN-06). */
  @Post('remind-pending')
  async remindPending(): Promise<{ reminded: number }> {
    return { reminded: await this.subOrders.remindPending() };
  }
}

const problemSchema = z.object({
  reason: z.enum(['non_conforme', 'casse', 'incomplet', 'autre']),
  description: z.string().trim().min(10, 'Décrivez le problème').max(2_000),
});

/**
 * Validation à la réception, côté client.
 *
 * Le cahier client : à réception, le client inspecte, puis « Valider la
 * réception » ou « Signaler un problème ». C'est ce clic qui décide du sort de
 * l'argent.
 */
@Controller('orders')
export class OrderValidationController {
  constructor(private readonly validation: ValidationService) {}

  @Post(':subOrderReference/validate')
  async validate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('subOrderReference') reference: string,
  ) {
    return this.validation.validate(user.id, reference);
  }

  @Post(':subOrderReference/report-problem')
  async reportProblem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('subOrderReference') reference: string,
    @Body(zodBody(problemSchema)) input: { reason: string; description: string },
  ) {
    return this.validation.reportProblem(user.id, reference, input.reason, input.description);
  }
}

/** Portefeuille du créateur : ce qui lui est dû, programmé, versé. */
@Controller('maker/wallet')
@Roles('MAKER')
export class MakerWalletController {
  constructor(private readonly validation: ValidationService) {}

  @Get()
  async balance(@CurrentUser() user: AuthenticatedUser) {
    return this.validation.makerBalance(user.id);
  }
}

/** Tâches planifiées, en attendant l'ordonnanceur. */
@Controller('admin/jobs')
@Roles('ADMIN')
export class JobsAdminController {
  constructor(private readonly validation: ValidationService) {}

  @Post('auto-validate')
  async autoValidate() {
    return this.validation.autoValidateStale();
  }

  @Post('release-payouts')
  async releasePayouts(): Promise<{ released: number }> {
    return { released: await this.validation.releaseDuePayouts() };
  }
}
