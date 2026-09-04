import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  markNotificationsReadSchema,
  notificationsQuerySchema,
  type MarkNotificationsReadInput,
  type NotificationsPage,
  type NotificationsQuery,
  type UnreadCount,
} from '@oja/contracts';

import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe, zodBody } from '../common/zod.pipe';
import { NotificationService } from './notification.service';

/**
 * Notifications in-app (cahier LN-04).
 *
 * Toute personne connectée voit les siennes, quel que soit son rôle. La
 * propriété est portée par `user.id` dans chaque requête — aucune notification
 * d'autrui n'est atteignable.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(notificationsQuerySchema)) query: NotificationsQuery,
  ): Promise<NotificationsPage> {
    return this.notifications.listForUser(user.id, query);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthenticatedUser): Promise<UnreadCount> {
    return { count: await this.notifications.unreadCount(user.id) };
  }

  @Post('read')
  @HttpCode(200)
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(markNotificationsReadSchema)) input: MarkNotificationsReadInput,
  ): Promise<{ updated: number }> {
    return this.notifications.markRead(user.id, input.ids);
  }
}
