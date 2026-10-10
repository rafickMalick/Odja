import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  exhibitionContractSchema,
  exhibitionFeatureSchema,
  exhibitionFileSchema,
  exhibitionPaymentSchema,
  exhibitionPlanSchema,
  exhibitionPlanUpdateSchema,
  exhibitionReviewSchema,
  exhibitionScheduleSchema,
  exhibitionSchema,
  exhibitionSuspendSchema,
  exhibitionUpdateSchema,
  exhibitionWorkReviewSchema,
  exhibitionWorkSchema,
  exhibitionWorkUpdateSchema,
  type AdminExhibition,
  type AdminExhibitionSummary,
  type ExhibitionCard,
  type ExhibitionContractInput,
  type ExhibitionFileInput,
  type ExhibitionInput,
  type ExhibitionPaymentInput,
  type ExhibitionPlanInput,
  type ExhibitionPlanUpdateInput,
  type ExhibitionPlanView,
  type ExhibitionReviewInput,
  type ExhibitionScheduleInput,
  type ExhibitionSuspendInput,
  type ExhibitionUpdateInput,
  type ExhibitionWorkInput,
  type ExhibitionWorkReviewInput,
  type ExhibitionWorkUpdateInput,
  type OrganizerExhibition,
  type PrivateFileLink,
  type PublicExhibition,
} from '@oja/contracts';

import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { zodBody } from '../common/zod.pipe';
import { ExhibitionAdminService } from './exhibition-admin.service';
import { ExhibitionService } from './exhibition.service';

/** Rubrique Expositions et page publique d'une exposition. */
@Controller('exhibitions')
export class ExhibitionPublicController {
  constructor(private readonly exhibitions: ExhibitionService) {}

  @Public()
  @Get()
  async list(
    @Query('when') when?: string,
    @Query('access') access?: string,
    @Query('featured') featured?: string,
  ): Promise<ExhibitionCard[]> {
    return this.exhibitions.listPublic({ when, access, featured: featured === '1' || featured === 'true' });
  }

  /** Formules proposées aux organisateurs. */
  @Public()
  @Get('plans')
  async plans(): Promise<ExhibitionPlanView[]> {
    return this.exhibitions.activePlans();
  }

  /* Route ouverte, mais le visiteur connecté est identifié : c'est ce qui
     ouvre la galerie au détenteur d'un billet. */
  @Public()
  @Get(':slug')
  async bySlug(
    @Param('slug') slug: string,
    @Req() request: { user?: AuthenticatedUser },
  ): Promise<PublicExhibition> {
    return this.exhibitions.publicBySlug(slug, request.user);
  }
}

/**
 * Dossiers de l'organisateur. Un compte suffit : un créateur inscrit comme un
 * organisateur externe (§ 6.2). Chacun n'accède qu'à ses propres dossiers.
 */
@Controller('my/exhibitions')
@Roles('CUSTOMER', 'MAKER', 'ADMIN')
export class ExhibitionOrganizerController {
  constructor(private readonly exhibitions: ExhibitionService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<OrganizerExhibition[]> {
    return this.exhibitions.listMine(user.id);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(exhibitionSchema)) input: ExhibitionInput,
  ): Promise<OrganizerExhibition> {
    return this.exhibitions.create(user, input);
  }

  @Get(':id')
  async one(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<OrganizerExhibition> {
    return this.exhibitions.mine(user.id, id);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(exhibitionUpdateSchema)) input: ExhibitionUpdateInput,
  ): Promise<OrganizerExhibition> {
    return this.exhibitions.update(user.id, id, input);
  }

  @Post(':id/files')
  async attachFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(exhibitionFileSchema)) input: ExhibitionFileInput,
  ): Promise<OrganizerExhibition> {
    return this.exhibitions.attachFile(user.id, id, input);
  }

  @Post(':id/works')
  async addWork(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(exhibitionWorkSchema)) input: ExhibitionWorkInput,
  ): Promise<OrganizerExhibition> {
    return this.exhibitions.addWork(user.id, id, input);
  }

  @Patch(':id/works/:workId')
  async updateWork(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('workId') workId: string,
    @Body(zodBody(exhibitionWorkUpdateSchema)) input: ExhibitionWorkUpdateInput,
  ): Promise<OrganizerExhibition> {
    return this.exhibitions.updateWork(user.id, id, workId, input);
  }

  @Delete(':id/works/:workId')
  async removeWork(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('workId') workId: string,
  ): Promise<OrganizerExhibition> {
    return this.exhibitions.removeWork(user.id, id, workId);
  }

  @Post(':id/submit')
  async submit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<OrganizerExhibition> {
    return this.exhibitions.submit(user.id, id);
  }
}

/** Instruction et pilotage des expositions par l'équipe Ojà (§ 11.3). */
@Controller('admin/exhibitions')
@Roles('ADMIN')
export class ExhibitionAdminController {
  constructor(private readonly admin: ExhibitionAdminService) {}

  @Get()
  async list(@Query('status') status?: string): Promise<AdminExhibitionSummary[]> {
    return this.admin.list(status);
  }

  @Get('plans')
  async plans(): Promise<ExhibitionPlanView[]> {
    return this.admin.plans();
  }

  @Post('plans')
  async createPlan(
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(exhibitionPlanSchema)) input: ExhibitionPlanInput,
  ): Promise<ExhibitionPlanView> {
    return this.admin.createPlan(admin.id, input);
  }

  @Patch('plans/:planId')
  async updatePlan(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('planId') planId: string,
    @Body(zodBody(exhibitionPlanUpdateSchema)) input: ExhibitionPlanUpdateInput,
  ): Promise<ExhibitionPlanView> {
    return this.admin.updatePlan(admin.id, planId, input);
  }

  @Get(':id')
  async one(@Param('id') id: string): Promise<AdminExhibition> {
    return this.admin.get(id);
  }

  /** Seul endroit qui délivre une URL de lecture du dossier et des justificatifs. */
  @Get(':id/files')
  async files(@Param('id') id: string): Promise<PrivateFileLink[]> {
    return this.admin.privateFiles(id);
  }

  @Post(':id/review')
  async review(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(exhibitionReviewSchema)) input: ExhibitionReviewInput,
  ): Promise<AdminExhibition> {
    return this.admin.review(id, admin.id, input);
  }

  @Post(':id/works/:workId/review')
  async reviewWork(
    @Param('id') id: string,
    @Param('workId') workId: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(exhibitionWorkReviewSchema)) input: ExhibitionWorkReviewInput,
  ): Promise<AdminExhibition> {
    return this.admin.reviewWork(id, workId, admin.id, input);
  }

  @Post(':id/contract')
  async contract(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(exhibitionContractSchema)) input: ExhibitionContractInput,
  ): Promise<AdminExhibition> {
    return this.admin.contract(id, admin.id, input);
  }

  @Post(':id/payment')
  async payment(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(exhibitionPaymentSchema)) input: ExhibitionPaymentInput,
  ): Promise<AdminExhibition> {
    return this.admin.payment(id, admin.id, input);
  }

  @Post(':id/schedule')
  async schedule(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(exhibitionScheduleSchema)) input: ExhibitionScheduleInput,
  ): Promise<AdminExhibition> {
    return this.admin.schedule(id, admin.id, new Date(input.publishAt));
  }

  @Post(':id/publish')
  async publish(@Param('id') id: string, @CurrentUser() admin: AuthenticatedUser): Promise<AdminExhibition> {
    return this.admin.publishNow(id, admin.id);
  }

  @Post(':id/suspend')
  async suspend(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(exhibitionSuspendSchema)) input: ExhibitionSuspendInput,
  ): Promise<AdminExhibition> {
    return this.admin.suspend(id, admin.id, input.reason);
  }

  @Post(':id/feature')
  async feature(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(exhibitionFeatureSchema)) input: { isFeatured: boolean },
  ): Promise<AdminExhibition> {
    return this.admin.setFeatured(id, admin.id, input.isFeatured);
  }
}
