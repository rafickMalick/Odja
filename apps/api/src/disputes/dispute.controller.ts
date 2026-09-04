import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  disputeMessageSchema,
  resolveDisputeSchema,
  type DisputeMessageInput,
  type DisputeView,
  type ResolveDisputeInput,
} from '@oja/contracts';

import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { zodBody } from '../common/zod.pipe';
import { DisputeService } from './dispute.service';

/**
 * Réclamations, vues par les deux parties.
 *
 * Client et créateur parlent chacun à Ojà, jamais l'un à l'autre : c'est la
 * règle métier qui fonde la place de marché.
 */
@Controller('disputes')
export class DisputeController {
  constructor(private readonly disputes: DisputeService) {}

  @Get()
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<DisputeView[]> {
    return user.role === 'MAKER'
      ? this.disputes.listForMaker(user.id)
      : this.disputes.listForCustomer(user.id);
  }

  @Get(':reference')
  async byReference(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
  ): Promise<DisputeView> {
    return this.disputes.byReference(reference, user);
  }

  @Post(':reference/messages')
  async reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
    @Body(zodBody(disputeMessageSchema)) input: DisputeMessageInput,
  ) {
    return this.disputes.addMessage(reference, user, input);
  }
}

@Controller('admin/disputes')
@Roles('ADMIN')
export class DisputeAdminController {
  constructor(private readonly disputes: DisputeService) {}

  @Get()
  async list(@Query('open') open?: string): Promise<DisputeView[]> {
    return this.disputes.listForAdmin(open === 'true');
  }

  /** Réclamations dont le délai de traitement est dépassé. */
  @Get('overdue')
  async overdue() {
    return this.disputes.listOverdue();
  }

  @Post(':reference/resolve')
  async resolve(
    @Param('reference') reference: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(resolveDisputeSchema)) input: ResolveDisputeInput,
  ) {
    return this.disputes.resolve(reference, admin.id, input);
  }
}
