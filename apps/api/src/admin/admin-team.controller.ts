import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { zodBody } from '../common/zod.pipe';
import { AdminTeamService } from './admin-team.service';

const grantSchema = z.object({
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide'),
});

/** Équipe d'administration : liste, nomination, retrait. */
@Controller('admin/team')
@Roles('ADMIN')
export class AdminTeamController {
  constructor(private readonly team: AdminTeamService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.team.list(user.id);
  }

  @Post()
  @HttpCode(201)
  async grant(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(grantSchema)) input: { email: string },
  ) {
    return this.team.grant(input.email, user.id);
  }

  @Delete(':userId')
  async revoke(@CurrentUser() user: AuthenticatedUser, @Param('userId') userId: string) {
    return this.team.revoke(userId, user.id);
  }

  /** Téléphone perdu : un collègue efface la double authentification. */
  @Post(':userId/mfa/reset')
  @HttpCode(200)
  async resetMfa(@CurrentUser() user: AuthenticatedUser, @Param('userId') userId: string) {
    return this.team.resetMfa(userId, user.id);
  }
}
