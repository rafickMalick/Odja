import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  attachKycDocumentSchema,
  kycReviewSchema,
  makerProfileSchema,
  makerProfileUpdateSchema,
  type AdminMaker,
  type AttachKycDocumentInput,
  type KycDocumentView,
  type KycReviewInput,
  type MakerProfileInput,
  type MakerProfileUpdateInput,
  type OwnMakerProfile,
  type PublicMaker,
} from '@oja/contracts';

import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { zodBody } from '../common/zod.pipe';
import { KycDocumentService } from './kyc-document.service';
import { MakerService } from './maker.service';

/** Vitrine publique d'un atelier — informations publiques uniquement. */
@Controller('makers')
export class MakerPublicController {
  constructor(private readonly makers: MakerService) {}

  @Public()
  @Get(':slug')
  async bySlug(@Param('slug') slug: string): Promise<PublicMaker> {
    return this.makers.publicBySlug(slug);
  }
}

/** Espace du créateur. Chacun n'accède qu'à sa propre boutique. */
@Controller('maker')
@Roles('MAKER')
export class MakerController {
  constructor(
    private readonly makers: MakerService,
    private readonly documents: KycDocumentService,
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
  ) {}

  /** Seul endroit du système qui délivre une URL de lecture d'une pièce. */
  @Get(':id/documents')
  async documentsOf(@Param('id') id: string): Promise<KycDocumentView[]> {
    return this.documents.listForReview({ makerId: id });
  }

  @Get()
  async list(@Query('status') status?: string): Promise<AdminMaker[]> {
    return this.makers.listForAdmin(status);
  }

  @Post(':id/review')
  async review(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(kycReviewSchema)) input: KycReviewInput,
  ): Promise<AdminMaker> {
    return this.makers.reviewKyc(id, admin.id, input);
  }
}
