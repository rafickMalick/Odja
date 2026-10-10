import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  accessCodeSchema,
  passRequestSchema,
  type AccessCodeInput,
  type AdminPassView,
  type ExhibitionPassView,
  type ExhibitionStats,
  type PassRequestInput,
  type TicketCheckout,
} from '@oja/contracts';

import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { zodBody } from '../common/zod.pipe';
import { ExhibitionPassService } from './exhibition-pass.service';

/**
 * Billetterie, côté visiteur. Un compte est demandé : c'est lui qui porte le
 * billet, et qui ouvre la galerie au visiteur sur chacun de ses appareils.
 */
@Controller('exhibitions')
@Roles('CUSTOMER', 'MAKER', 'COURIER', 'ADMIN')
export class ExhibitionPassController {
  constructor(private readonly passes: ExhibitionPassService) {}

  @Get('passes/mine')
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<ExhibitionPassView[]> {
    return this.passes.mine(user.id);
  }

  @Post(':slug/register')
  async register(
    @Param('slug') slug: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(passRequestSchema)) input: PassRequestInput,
  ): Promise<ExhibitionPassView> {
    return this.passes.register(slug, user.id, input.format);
  }

  @Post(':slug/code')
  async code(
    @Param('slug') slug: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(accessCodeSchema)) input: AccessCodeInput,
  ): Promise<ExhibitionPassView> {
    return this.passes.redeemCode(slug, user.id, input.code, input.format);
  }

  @Post(':slug/tickets')
  async buy(
    @Param('slug') slug: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(passRequestSchema)) input: PassRequestInput,
  ): Promise<TicketCheckout> {
    return this.passes.buyTicket(slug, user.id, input.format);
  }

  @Post('passes/:reference/verify')
  async verify(
    @Param('reference') reference: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ExhibitionPassView> {
    return this.passes.verify(reference, user.id);
  }

  /** Développement et recette uniquement : refusée en production. */
  @Post('passes/:reference/simulate-payment')
  async simulate(
    @Param('reference') reference: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ExhibitionPassView> {
    return this.passes.simulatePayment(reference, user.id);
  }
}

/** Inscriptions, billets et chiffres d'une exposition (§ 11.4, 11.5). */
@Controller('admin/exhibitions')
@Roles('ADMIN')
export class ExhibitionPassAdminController {
  constructor(private readonly passes: ExhibitionPassService) {}

  @Get(':id/passes')
  async list(@Param('id') id: string): Promise<AdminPassView[]> {
    return this.passes.listForExhibition(id);
  }

  @Get(':id/stats')
  async stats(@Param('id') id: string): Promise<ExhibitionStats> {
    return this.passes.stats(id);
  }
}
