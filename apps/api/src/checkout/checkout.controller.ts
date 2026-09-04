import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import {
  applyPromoSchema,
  placeOrderSchema,
  quoteSchema,
  verifyPaymentSchema,
  type ApplyPromoInput,
  type CheckoutQuote,
  type InvoiceView,
  type OrderView,
  type PlaceOrderInput,
  type PromoView,
  type QuoteInput,
  type VerifyPaymentInput,
} from '@oja/contracts';
import type { Request } from 'express';

import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CartService } from '../cart/cart.service';
import { cursorQuerySchema, type CursorQuery, type Page } from '../common/pagination';
import { ZodValidationPipe, zodBody } from '../common/zod.pipe';
import { InvoiceService } from './invoice.service';
import { OrderService } from './order.service';
import { QuoteService } from './quote.service';

const CART_COOKIE = 'oja_cart';

@Controller()
export class CheckoutController {
  constructor(
    private readonly carts: CartService,
    private readonly quotes: QuoteService,
    private readonly orders: OrderService,
    private readonly invoices: InvoiceService,
  ) {}

  /** Chiffrage sans engagement : totaux, livraisons par atelier, délais. */
  @Post('checkout/quote')
  async quote(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Body(zodBody(quoteSchema)) input: QuoteInput,
  ): Promise<CheckoutQuote> {
    const cartId = await this.cartIdOf(user, request);
    return this.quotes.quote(cartId, user.id, input.addressId, input.promoCode);
  }

  /**
   * Aperçu d'un code promo seul, sans recharger tout le chiffrage.
   *
   * Renvoie la remise si le code s'applique, une erreur explicite sinon —
   * c'est ce que le champ « Code promo » du checkout affiche sous lui.
   */
  @Post('checkout/promo')
  async previewPromo(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Body(zodBody(applyPromoSchema)) input: ApplyPromoInput,
  ): Promise<PromoView> {
    const cartId = await this.cartIdOf(user, request);
    const quote = await this.quotes.quote(cartId, user.id, input.addressId, input.code);
    if (!quote.promo) {
      const reason = quote.blockers.find((message) => message.includes(input.code));
      throw new BadRequestException(reason ?? `Code promo « ${input.code} » refusé.`);
    }
    return {
      code: quote.promo.code,
      label: quote.promo.label,
      discountXof: quote.discountXof,
    };
  }

  @Post('checkout')
  async place(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Body(zodBody(placeOrderSchema)) input: PlaceOrderInput,
  ): Promise<OrderView> {
    const cartId = await this.cartIdOf(user, request);
    return this.orders.placeOrder(
      user.id,
      cartId,
      input.addressId,
      input.expectedTotalXof,
      input.promoCode,
    );
  }

  @Get('orders')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(cursorQuerySchema)) query: CursorQuery,
  ): Promise<Page<OrderView>> {
    return this.orders.listMine(user.id, query);
  }

  @Get('orders/:reference')
  async byReference(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
  ): Promise<OrderView> {
    return this.orders.byReference(reference, user.id);
  }

  /**
   * Facture de la commande (cahier L2-20).
   *
   * Émise à la première demande si elle n'existe pas encore, puis figée. On ne
   * renvoie jamais le PDF : une URL signée de courte durée.
   */
  @Get('orders/:reference/invoice')
  async invoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
  ): Promise<InvoiceView> {
    return this.invoices.urlForOrder(reference, user.id, false);
  }

  /** Interroge activement le fournisseur — voir OrderService.verifyPayment. */
  @Post('orders/:reference/verify-payment')
  async verifyPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
    @Body(zodBody(verifyPaymentSchema)) input: VerifyPaymentInput,
  ): Promise<OrderView> {
    return this.orders.verifyPayment(reference, user.id, input.providerRef);
  }

  private async cartIdOf(user: AuthenticatedUser, request: Request): Promise<string> {
    const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
    const { id } = await this.carts.resolve(user.id, cookies?.[CART_COOKIE] ?? null);
    return id;
  }
}

/** Facture d'une commande, côté back-office. */
@Controller('admin/orders')
@Roles('ADMIN')
export class InvoiceAdminController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get(':reference/invoice')
  async invoice(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('reference') reference: string,
  ): Promise<InvoiceView> {
    return this.invoices.urlForOrder(reference, admin.id, true);
  }
}
