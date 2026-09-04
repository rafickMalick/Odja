import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { zodBody } from '../common/zod.pipe';
import { BackOfficeService } from './back-office.service';

const activeSchema = z.object({ isActive: z.boolean() });

/** Lectures du back-office : grand livre, journal, commandes, paramétrage. */
@Controller('admin')
@Roles('ADMIN')
export class BackOfficeController {
  constructor(private readonly backOffice: BackOfficeService) {}

  @Get('ledger')
  async ledger() {
    return this.backOffice.ledgerBalances();
  }

  @Get('ledger/transactions')
  async transactions(@Query('limit') limit?: string) {
    return this.backOffice.ledgerTransactions(limit ? Number(limit) : 50);
  }

  @Get('audit')
  async audit(
    @Query('action') action?: string,
    @Query('targetId') targetId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.backOffice.auditLog({
      ...(action ? { action } : {}),
      ...(targetId ? { targetId } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
    });
  }

  @Get('orders/search')
  async searchOrders(@Query('q') q?: string, @Query('status') status?: string) {
    return this.backOffice.searchOrders(q, status);
  }

  @Get('settings')
  async settings() {
    return this.backOffice.settings();
  }

  /* Ouvrir un pays est un réglage, pas un déploiement (cahier § 13). */
  @Post('settings/countries/:id/active')
  async setCountryActive(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(activeSchema)) input: { isActive: boolean },
  ) {
    return this.backOffice.setCountryActive(id, input.isActive, admin.id);
  }
}
