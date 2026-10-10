import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  attachKycDocumentSchema,
  documentRequestSchema,
  type DocumentRequestInput,
  grantSubscriptionSchema,
  kycReviewSchema,
  makerDirectoryQuerySchema,
  makerImageSchema,
  makerProfileSchema,
  makerProfileUpdateSchema,
  visibilityPlanSchema,
  visibilityPlanUpdateSchema,
  type AdminMaker,
  type AttachKycDocumentInput,
  type GrantSubscriptionInput,
  type KycDocumentView,
  type KycReviewInput,
  type MakerCard,
  type MakerDirectoryQuery,
  type MakerImageInput,
  type MakerProfileInput,
  type MakerProfileUpdateInput,
  type MakerSubscriptionView,
  type MakerWork,
  type MyVisibility,
  type OwnMakerProfile,
  type Page,
  type PublicMaker,
  type VisibilityPlanInput,
  type VisibilityPlanUpdateInput,
  type VisibilityPlanView,
} from '@oja/contracts';

import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { zodBody, ZodValidationPipe } from '../common/zod.pipe';
import { KycDocumentService } from './kyc-document.service';
import { MakerService } from './maker.service';
import { VisibilityService } from './visibility.service';

/** Vitrine publique d'un atelier — informations publiques uniquement. */
@Controller('makers')
export class MakerPublicController {
  constructor(private readonly makers: MakerService) {}

  /** Annuaire des créateurs, filtrable par zone et par statut. */
  @Public()
  @Get()
  async directory(
    @Query(new ZodValidationPipe(makerDirectoryQuerySchema)) query: MakerDirectoryQuery,
  ): Promise<Page<MakerCard>> {
    return this.makers.directory(query);
  }

  @Public()
  @Get(':slug')
  async bySlug(@Param('slug') slug: string): Promise<PublicMaker> {
    return this.makers.publicBySlug(slug);
  }

  /** Galerie : pièces en vente, vendues et réalisations de portfolio. */
  @Public()
  @Get(':slug/works')
  async works(@Param('slug') slug: string): Promise<MakerWork[]> {
    return this.makers.worksBySlug(slug);
  }
}

/** Espace du créateur. Chacun n'accède qu'à sa propre boutique. */
@Controller('maker')
@Roles('MAKER')
export class MakerController {
  constructor(
    private readonly makers: MakerService,
    private readonly documents: KycDocumentService,
    private readonly visibility: VisibilityService,
  ) {}

  /* Le déposant voit le type et le statut de ses pièces, jamais le fichier :
     chaque URL délivrée est une occasion de fuite en plus, et il sait déjà ce
     qu'il a envoyé. */

  @Get('kyc/documents')
  async listDocuments(@CurrentUser() user: AuthenticatedUser): Promise<KycDocumentView[]> {
    return this.documents.listForMaker(user.id);
  }

  @Post('kyc/documents')
  async attachDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(attachKycDocumentSchema)) input: AttachKycDocumentInput,
  ): Promise<KycDocumentView[]> {
    return this.documents.attachForMaker(user.id, input);
  }

  @Post('profile')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(makerProfileSchema)) input: MakerProfileInput,
  ): Promise<AdminMaker> {
    return this.makers.createProfile(user.id, input);
  }

  @Get('profile')
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<OwnMakerProfile> {
    return this.makers.myProfile(user.id);
  }

  @Patch('profile')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(makerProfileUpdateSchema)) input: MakerProfileUpdateInput,
  ): Promise<AdminMaker> {
    return this.makers.updateProfile(user.id, input);
  }

  /** Logo ou bannière, après envoi du fichier au stockage. */
  @Post('profile/images')
  async setImage(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(makerImageSchema)) input: MakerImageInput,
  ): Promise<OwnMakerProfile> {
    return this.makers.setImage(user.id, input);
  }

  @Delete('profile/images/:slot')
  async removeImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slot') slot: string,
  ): Promise<OwnMakerProfile> {
    if (slot !== 'logo' && slot !== 'cover') return this.makers.myProfile(user.id);
    return this.makers.removeImage(user.id, slot);
  }

  /** Formule en cours, usage du quota et formules proposées. */
  @Get('visibility')
  async myVisibility(@CurrentUser() user: AuthenticatedUser): Promise<MyVisibility> {
    return this.visibility.mine(user.id);
  }

  @Post('kyc/submit')
  async submitKyc(@CurrentUser() user: AuthenticatedUser): Promise<{ status: string }> {
    return this.makers.submitKyc(user.id);
  }
}

/** Validation des ateliers par l'équipe Ojà. */
@Controller('admin/makers')
@Roles('ADMIN')
export class MakerAdminController {
  constructor(
    private readonly makers: MakerService,
    private readonly documents: KycDocumentService,
    private readonly visibility: VisibilityService,
  ) {}

  /** Seul endroit du système qui délivre une URL de lecture d'une pièce. */
  @Get(':id/documents')
  async documentsOf(@Param('id') id: string): Promise<KycDocumentView[]> {
    return this.documents.listForReview({ makerId: id });
  }

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('profile') profile?: string,
  ): Promise<AdminMaker[]> {
    return this.makers.listForAdmin(status, profile);
  }

  /** Demande d'une pièce complémentaire, sans refuser le dossier. */
  @Post(':id/request-document')
  async requestDocument(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(documentRequestSchema)) input: DocumentRequestInput,
  ): Promise<{ status: string }> {
    await this.makers.requestDocument(id, admin.id, input.message);
    return { status: 'REQUESTED' };
  }

  @Post(':id/review')
  async review(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(kycReviewSchema)) input: KycReviewInput,
  ): Promise<AdminMaker> {
    return this.makers.reviewKyc(id, admin.id, input);
  }

  // ── Formule de visibilité d'un atelier ──

  @Get(':id/subscriptions')
  async subscriptions(@Param('id') id: string): Promise<MakerSubscriptionView[]> {
    return this.visibility.history(id);
  }

  /** Active une formule après réception du paiement. */
  @Post(':id/subscriptions')
  async grant(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(grantSubscriptionSchema)) input: GrantSubscriptionInput,
  ): Promise<MakerSubscriptionView[]> {
    return this.visibility.grant(id, admin.id, input);
  }

  @Post(':id/subscriptions/:subscriptionId/cancel')
  async cancel(
    @Param('id') id: string,
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<MakerSubscriptionView[]> {
    return this.visibility.cancel(id, subscriptionId, admin.id);
  }
}

/** Réglage des formules elles-mêmes : quotas, durée, prix, avantages. */
@Controller('admin/visibility-plans')
@Roles('ADMIN')
export class VisibilityPlanAdminController {
  constructor(private readonly visibility: VisibilityService) {}

  @Get()
  async list(): Promise<VisibilityPlanView[]> {
    return this.visibility.listPlans();
  }

  @Post()
  async create(
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(visibilityPlanSchema)) input: VisibilityPlanInput,
  ): Promise<VisibilityPlanView> {
    return this.visibility.createPlan(admin.id, input);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(visibilityPlanUpdateSchema)) input: VisibilityPlanUpdateInput,
  ): Promise<VisibilityPlanView> {
    return this.visibility.updatePlan(admin.id, id, input);
  }
}
