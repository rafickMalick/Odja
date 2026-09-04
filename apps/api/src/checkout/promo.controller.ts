import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  promoCodeInputSchema,
  promoCodeUpdateSchema,
  type AdminPromoCode,
  type PromoCodeInput,
  type PromoCodeUpdateInput,
} from '@oja/contracts';

import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { zodBody } from '../common/zod.pipe';
import { PromoService } from './promo.service';

/** Codes promo — création et suivi par l'équipe Ojà (cahier L2-11 / L7). */
@Controller('admin/promo-codes')
@Roles('ADMIN')
export class PromoAdminController {
  constructor(private readonly promos: PromoService) {}

  @Get()
  async list(): Promise<AdminPromoCode[]> {
    return this.promos.list();
  }

  @Post()
  async create(
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(promoCodeInputSchema)) input: PromoCodeInput,
  ): Promise<AdminPromoCode> {
    return this.promos.create(input, admin.id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(promoCodeUpdateSchema)) input: PromoCodeUpdateInput,
  ): Promise<AdminPromoCode> {
    return this.promos.update(id, input, admin.id);
  }
}
