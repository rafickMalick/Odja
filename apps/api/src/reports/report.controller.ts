import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import {
  reportResolutionSchema,
  reportSchema,
  type CreativeOverview,
  type ReportInput,
  type ReportResolutionInput,
  type ReportView,
} from '@oja/contracts';

import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Throttle } from '../common/rate-limit.guard';
import { zodBody } from '../common/zod.pipe';
import { ReportService } from './report.service';

/**
 * Signaler un contenu : ouvert à tous, connecté ou non. Le débit est limité,
 * pour qu'un formulaire public ne serve pas à noyer la file d'examen.
 */
@Controller('reports')
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  @Public()
  @Throttle(5, 3_600)
  @Post()
  async create(
    @Body(zodBody(reportSchema)) input: ReportInput,
    @Req() request: { user?: AuthenticatedUser },
  ): Promise<{ reference: string }> {
    return this.reports.create(input, request.user?.id);
  }
}

@Controller('admin')
@Roles('ADMIN')
export class ReportAdminController {
  constructor(private readonly reports: ReportService) {}

  @Get('reports')
  async list(@Query('status') status?: string): Promise<ReportView[]> {
    return this.reports.list(status);
  }

  @Post('reports/:id/resolve')
  async resolve(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(reportResolutionSchema)) input: ReportResolutionInput,
  ): Promise<ReportView> {
    return this.reports.resolve(id, admin.id, input);
  }

  /** Tableau de bord des profils créatifs, expositions et signalements. */
  @Get('creative-overview')
  async overview(): Promise<CreativeOverview> {
    return this.reports.overview();
  }
}
