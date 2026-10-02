import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { addToCartSchema, updateCartItemSchema, type AddToCartInput, type CartView } from '@oja/contracts';
import type { Request, Response } from 'express';

import { Public } from '../auth/decorators/public.decorator';
import { cookieDomain } from '../common/cookie-domain';
import { zodBody } from '../common/zod.pipe';
import { CartService } from './cart.service';

const CART_COOKIE = 'oja_cart';

/**
 * Panier.
 *
 * Les routes sont publiques : un visiteur a droit à un panier avant de créer
 * un compte. Lui demander de s'inscrire avant d'avoir choisi quoi que ce soit
 * est le meilleur moyen de le perdre. L'identité vient du jeton de session
 * quand elle existe, du cookie de panier sinon.
 */
@Controller('cart')
export class CartController {
  constructor(private readonly carts: CartService) {}

  @Public()
  @Get()
  async view(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<CartView> {
    const { id } = await this.current(request, response);
    return this.carts.view(id);
  }

  @Public()
  @Post('items')
  async add(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body(zodBody(addToCartSchema)) input: AddToCartInput,
  ): Promise<CartView> {
    const { id } = await this.current(request, response);
    await this.carts.addItem(id, input.productId, input.quantity);
    return this.carts.view(id);
  }

  @Public()
  @Patch('items/:itemId')
  async setQuantity(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('itemId') itemId: string,
    @Body(zodBody(updateCartItemSchema)) input: { quantity: number },
  ): Promise<CartView> {
    const { id } = await this.current(request, response);
    await this.carts.setQuantity(id, itemId, input.quantity);
    return this.carts.view(id);
  }

  @Public()
  @Delete('items/:itemId')
  async remove(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('itemId') itemId: string,
  ): Promise<CartView> {
    const { id } = await this.current(request, response);
    await this.carts.removeItem(id, itemId);
    return this.carts.view(id);
  }

  @Public()
  @Delete()
  @HttpCode(204)
  async clear(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    const { id } = await this.current(request, response);
    await this.carts.clear(id);
  }

  /**
   * Résout le panier courant et rafraîchit le cookie.
   *
   * Le cookie n'est pas `httpOnly` par nécessité — il ne porte aucune autorité,
   * seulement l'identité d'un panier anonyme. Il reste `sameSite: lax` pour
   * qu'un site tiers ne puisse pas le faire voyager.
   */
  private async current(request: Request, response: Response): Promise<{ id: string }> {
    const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
    const user = (request as Request & { user?: { id: string } }).user ?? null;

    const { id, token } = await this.carts.resolve(user?.id ?? null, cookies?.[CART_COOKIE] ?? null);

    response.cookie(CART_COOKIE, token, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      maxAge: 30 * 86_400_000,
      path: '/',
      ...cookieDomain(),
    });

    return { id };
  }
}
