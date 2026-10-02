import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  adminTicketMessageSchema,
  adminTicketsQuerySchema,
  createTicketSchema,
  myTicketsQuerySchema,
  ticketMessageSchema,
  updateTicketSchema,
  type AdminTicketMessageInput,
  type AdminTicketsQuery,
  type CreateTicketInput,
  type TicketMessageInput,
  type TicketStatus,
  type UpdateTicketInput,
} from '@oja/contracts';

import { z } from 'zod';

import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Throttle } from '../common/rate-limit.guard';
import { ZodValidationPipe, zodBody } from '../common/zod.pipe';
import { SupportService } from './support.service';

const attachmentQuerySchema = z.object({ key: z.string().trim().min(1).max(300) });

/**
 * Demandes au service client, côté acheteur et créateur.
 *
 * La propriété est portée par `user.id` dans chaque requête du service : une
 * référence d'autrui répond 404, comme une référence inexistante.
 */
@Controller('support/tickets')
@Roles('CUSTOMER', 'MAKER')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  /** Types de problème proposés à mon espace. */
  @Get('categories')
  categories(@CurrentUser() user: AuthenticatedUser): Record<string, string> {
    return this.support.categoriesFor(user.role);
  }

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(myTicketsQuerySchema)) query: { status?: TicketStatus },
  ) {
    return this.support.listMine(user.id, query.status);
  }

  /* Ouvrir une demande n'est pas un geste répété : la limite empêche un
     script de remplir la file du service client. */
  @Throttle(10, 3_600)
  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createTicketSchema)) input: CreateTicketInput,
  ) {
    return this.support.create(user, input);
  }

  @Get(':reference')
  async get(@CurrentUser() user: AuthenticatedUser, @Param('reference') reference: string) {
    return this.support.mine(user, reference);
  }

  /** Lien de lecture temporaire d'une pièce jointe de ma demande. */
  @Get(':reference/attachment')
  async attachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
    @Query(new ZodValidationPipe(attachmentQuerySchema)) query: { key: string },
  ) {
    return this.support.myAttachmentUrl(user.id, reference, query.key);
  }

  @Throttle(30, 3_600)
  @Post(':reference/messages')
  async reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
    @Body(zodBody(ticketMessageSchema)) input: TicketMessageInput,
  ) {
    return this.support.reply(user, reference, input);
  }
}

/** File du service client : toutes les demandes, réponses, statuts, notes internes. */
@Controller('admin/support/tickets')
@Roles('ADMIN')
export class SupportAdminController {
  constructor(private readonly support: SupportService) {}

  @Get()
  async list(@Query(new ZodValidationPipe(adminTicketsQuerySchema)) query: AdminTicketsQuery) {
    return this.support.adminList(query);
  }

  @Get('pending-count')
  async pendingCount() {
    return this.support.adminPendingCount();
  }

  @Get(':reference')
  async get(@Param('reference') reference: string) {
    return this.support.adminGet(reference);
  }

  @Get(':reference/attachment')
  async attachment(
    @Param('reference') reference: string,
    @Query(new ZodValidationPipe(attachmentQuerySchema)) query: { key: string },
  ) {
    return this.support.adminAttachmentUrl(reference, query.key);
  }

  @Post(':reference/messages')
  async reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
    @Body(zodBody(adminTicketMessageSchema)) input: AdminTicketMessageInput,
  ) {
    return this.support.adminReply(user.id, reference, input);
  }

  @Patch(':reference')
  async update(
    @Param('reference') reference: string,
    @Body(zodBody(updateTicketSchema)) input: UpdateTicketInput,
  ) {
    return this.support.adminUpdate(reference, input);
  }
}
