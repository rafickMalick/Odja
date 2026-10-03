import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  attachKycDocumentSchema,
  courierProfileSchema,
  courierProfileUpdateSchema,
  courierRemittanceSchema,
  kycReviewSchema,
  type AttachKycDocumentInput,
  type CourierCashView,
  type CourierEarnings,
  type CourierProfileInput,
  type CourierProfileUpdateInput,
  type CourierProfileView,
  type CourierRemittanceInput,
  type KycDocumentView,
  type KycReviewInput,
} from '@oja/contracts';
import { z } from 'zod';

import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Throttle } from '../common/rate-limit.guard';
import { zodBody } from '../common/zod.pipe';
import { KycDocumentService } from '../makers/kyc-document.service';
import { CourierService } from './courier.service';
import { ShipmentService } from './shipment.service';

const positionSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const proofSchema = z.object({
  otp: z.string().trim().regex(/^\d{4}$/, 'Le code comporte 4 chiffres').optional(),
  photoKey: z.string().trim().max(300).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  /** Espèces encaissées auprès du client (paiement à la livraison ou solde). */
  cashCollectedXof: z.number().int().min(0).max(100_000_000).optional(),
});

const assignSchema = z.object({ courierId: z.string().min(1) });

const runSchema = z.object({
  courierId: z.string().min(1),
  shipmentReferences: z.array(z.string().min(1)).min(1, 'Au moins une mission'),
  plannedFor: z.coerce.date(),
});

const availabilitySchema = z.object({ isAvailable: z.boolean() });

/** Espace livreur : ses missions et leur avancement. */
@Controller('courier')
@Roles('COURIER')
export class CourierController {
  constructor(
    private readonly shipments: ShipmentService,
    private readonly couriers: CourierService,
    private readonly documents: KycDocumentService,
  ) {}

  /* ── Dossier ──
     Un livreur qui vient de s'inscrire n'a rien : ni profil, ni pièces, ni
     droit de rouler. Ces routes sont l'unique chemin vers la validation. */

  @Post('profile')
  async createProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(courierProfileSchema)) input: CourierProfileInput,
  ): Promise<CourierProfileView> {
    return this.couriers.createProfile(user.id, input);
  }

  @Get('profile')
  async myProfile(@CurrentUser() user: AuthenticatedUser): Promise<CourierProfileView> {
    return this.couriers.myProfile(user.id);
  }

  @Patch('profile')
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(courierProfileUpdateSchema)) input: CourierProfileUpdateInput,
  ): Promise<CourierProfileView> {
    return this.couriers.updateProfile(user.id, input);
  }

  @Get('kyc/documents')
  async listDocuments(@CurrentUser() user: AuthenticatedUser): Promise<KycDocumentView[]> {
    return this.documents.listForCourier(user.id);
  }

  @Post('kyc/documents')
  async attachDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(attachKycDocumentSchema)) input: AttachKycDocumentInput,
  ): Promise<KycDocumentView[]> {
    return this.documents.attachForCourier(user.id, input);
  }

  @Post('kyc/submit')
  async submitKyc(@CurrentUser() user: AuthenticatedUser): Promise<{ status: string }> {
    return this.couriers.submitKyc(user.id);
  }

  @Get('earnings')
  async earnings(@CurrentUser() user: AuthenticatedUser): Promise<CourierEarnings> {
    return this.couriers.earnings(user.id);
  }

  /* ── Missions ── */

  @Get('missions')
  async missions(@CurrentUser() user: AuthenticatedUser, @Query('scope') scope?: string) {
    return this.shipments.myMissions(user.id, scope === 'past' ? 'past' : 'current');
  }

  @Post('missions/:reference/pickup')
  async pickUp(@CurrentUser() user: AuthenticatedUser, @Param('reference') reference: string) {
    return this.shipments.pickUp(user.id, reference);
  }

  @Post('missions/:reference/start')
  async start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
    @Body(zodBody(positionSchema.partial())) position: Partial<z.infer<typeof positionSchema>>,
  ) {
    const point =
      position.latitude !== undefined && position.longitude !== undefined
        ? { latitude: position.latitude, longitude: position.longitude }
        : undefined;
    return this.shipments.startDelivery(user.id, reference, point);
  }

  @Post('missions/:reference/position')
  @HttpCode(204)
  async position(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
    @Body(zodBody(positionSchema)) position: z.infer<typeof positionSchema>,
  ): Promise<void> {
    await this.shipments.reportPosition(user.id, reference, position);
  }

  /**
   * Remise au client. Refusée sans deux éléments de preuve sur trois.
   *
   * Le code de remise ne fait que quatre chiffres : sans limite de débit, dix
   * mille essais le trouvent en quelques minutes, et une livraison serait
   * validée sans que le client ait rien vu. C'est le point le plus faible du
   * circuit financier.
   */
  @Throttle(10, 900)
  @Post('missions/:reference/deliver')
  async deliver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
    @Body(zodBody(proofSchema)) proof: z.infer<typeof proofSchema>,
  ) {
    const { cashCollectedXof, ...evidence } = proof;
    return this.shipments.deliver(user.id, reference, evidence, cashCollectedXof);
  }

  @Post('availability')
  async availability(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(availabilitySchema)) input: { isAvailable: boolean },
  ) {
    return this.shipments.setAvailability(user.id, input.isAvailable);
  }
}

/** Validation des livreurs par l'équipe Ojà. */
@Controller('admin/couriers')
@Roles('ADMIN')
export class CourierAdminController {
  constructor(
    private readonly couriers: CourierService,
    private readonly documents: KycDocumentService,
  ) {}

  @Get()
  async list(@Query('status') status?: string): Promise<CourierProfileView[]> {
    return this.couriers.listForAdmin(status);
  }

  /** Espèces encaissées à la livraison, à récupérer auprès de chaque livreur. */
  @Get('cash')
  async cash(): Promise<CourierCashView[]> {
    return this.couriers.cashHeld();
  }

  @Post(':id/remittance')
  async remit(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(courierRemittanceSchema)) input: CourierRemittanceInput,
  ): Promise<CourierCashView> {
    return this.couriers.recordRemittance(id, admin.id, input);
  }

  /** Seul endroit du système qui délivre une URL de lecture d'une pièce. */
  @Get(':id/documents')
  async documentsOf(@Param('id') id: string): Promise<KycDocumentView[]> {
    return this.documents.listForReview({ courierId: id });
  }

  @Post(':id/review')
  async review(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(kycReviewSchema)) input: KycReviewInput,
  ): Promise<CourierProfileView> {
    return this.couriers.reviewKyc(id, admin.id, input);
  }
}

/** Le cahier client confie l'affectation à l'administration. */
@Controller('admin/logistics')
@Roles('ADMIN')
export class LogisticsAdminController {
  constructor(private readonly shipments: ShipmentService) {}

  @Get('unassigned')
  async unassigned() {
    return this.shipments.listUnassigned();
  }

  @Get('shipments/:reference/couriers')
  async suggest(@Param('reference') reference: string) {
    return this.shipments.suggestCouriers(reference);
  }

  @Post('shipments/:reference/assign')
  async assign(
    @Param('reference') reference: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(assignSchema)) input: { courierId: string },
  ) {
    return this.shipments.assign(reference, input.courierId, admin.id);
  }

  @Post('runs')
  async createRun(
    @CurrentUser() admin: AuthenticatedUser,
    @Body(zodBody(runSchema)) input: z.infer<typeof runSchema>,
  ) {
    return this.shipments.createRun(
      input.courierId,
      admin.id,
      input.shipmentReferences,
      input.plannedFor,
    );
  }
}
