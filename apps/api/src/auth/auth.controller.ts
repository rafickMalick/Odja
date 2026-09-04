import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendCodeSchema,
  resendEmailSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
  verifyPhoneSchema,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type PublicUser,
  type RegisterInput,
  type ResetPasswordInput,
  type UpdateProfileInput,
  type VerifyPhoneInput,
} from '@oja/contracts';
import type { Request, Response } from 'express';

import { Throttle } from '../common/rate-limit.guard';
import { zodBody } from '../common/zod.pipe';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { CurrentUser, type AuthenticatedUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import type { IssuedTokens } from './token.service';

const ACCESS_COOKIE = 'oja_access';
const REFRESH_COOKIE = 'oja_refresh';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  /**
   * L'inscription ouvre le compte et la session dans le même geste.
   *
   * Un e-mail de confirmation part, mais il n'arrête personne : bloquer
   * l'accès derrière un clic dans une boîte aux lettres perd le visiteur au
   * moment précis où il vient d'arriver.
   */
  @Public()
  @Throttle(5, 3_600)
  @Post('register')
  @HttpCode(201)
  async register(
    @Body(zodBody(registerSchema)) input: RegisterInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: PublicUser | null; pendingPhone: boolean }> {
    const result = await this.auth.register(input, contextOf(request));

    /* Le compte s'ouvre immédiatement : un e-mail de confirmation part, mais
       il n'arrête personne. Quand la vérification par SMS sera réactivée,
       `pendingPhone` repassera à true et le front redemandera un code. */
    if (result.tokens) setAuthCookies(response, result.tokens);

    return { user: result.user, pendingPhone: result.pendingPhone };
  }

  /** Confirmation d'adresse e-mail, par le lien reçu. */
  @Public()
  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(
    @Body(zodBody(verifyEmailSchema)) input: { token: string },
  ): Promise<{ verified: true }> {
    await this.emailVerification.verify(input.token);
    return { verified: true };
  }

  @Public()
  @Throttle(3, 900)
  @Post('resend-email')
  @HttpCode(202)
  async resendEmail(
    @Body(zodBody(resendEmailSchema)) input: { email: string },
  ): Promise<{ message: string }> {
    await this.emailVerification.resend(input.email);
    // Réponse identique que l'adresse existe ou non.
    return { message: 'Si cette adresse attend une confirmation, un lien vient d’être envoyé.' };
  }

  @Public()
  @Throttle(5, 900)
  @Post('verify-phone')
  async verifyPhone(
    @Body(zodBody(verifyPhoneSchema)) input: VerifyPhoneInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: PublicUser }> {
    const { tokens, user } = await this.auth.verifyPhone(
      input.phone,
      input.code,
      contextOf(request),
    );
    setAuthCookies(response, tokens);
    return { user };
  }

  @Public()
  @Throttle(3, 900)
  @Post('resend-code')
  @HttpCode(202)
  async resendCode(
    @Body(zodBody(resendCodeSchema)) input: { phone: string },
  ): Promise<{ message: string }> {
    await this.auth.resendPhoneCode(input.phone);
    return { message: 'Si ce numéro attend une vérification, un code vient d’être envoyé.' };
  }

  /* Dix tentatives par quart d'heure. Un humain qui se trompe de mot de passe
     recommence deux ou trois fois ; un script en essaie des milliers. */
  @Public()
  @Throttle(10, 900)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(zodBody(loginSchema)) input: LoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: PublicUser }> {
    const { tokens, user } = await this.auth.login(
      input.identifier,
      input.password,
      contextOf(request),
    );
    setAuthCookies(response, tokens);
    return { user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ refreshed: true }> {
    const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
    const token = cookies?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('Aucune session à rafraîchir.');

    const tokens = await this.auth.refresh(token, contextOf(request));
    setAuthCookies(response, tokens);
    return { refreshed: true };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(user.sessionId);
    clearAuthCookies(response);
  }

  /** Déconnexion de tous les appareils. */
  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ closedSessions: number }> {
    const closedSessions = await this.auth.logoutEverywhere(user.id);
    clearAuthCookies(response);
    return { closedSessions };
  }

  @Public()
  @Throttle(3, 900)
  @Post('forgot-password')
  @HttpCode(202)
  async forgotPassword(
    @Body(zodBody(forgotPasswordSchema)) input: ForgotPasswordInput,
  ): Promise<{ message: string }> {
    await this.auth.forgotPassword(input.identifier);
    return { message: 'Si ce compte existe, un code vient d’être envoyé.' };
  }

  @Public()
  @Throttle(5, 900)
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(
    @Body(zodBody(resetPasswordSchema)) input: ResetPasswordInput,
  ): Promise<{ message: string }> {
    await this.auth.resetPassword(input.identifier, input.code, input.password);
    return {
      message: 'Mot de passe modifié. Toutes les sessions ouvertes ont été fermées.',
    };
  }

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser): Promise<PublicUser> {
    return this.auth.currentUser(user.id);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(updateProfileSchema)) input: UpdateProfileInput,
  ): Promise<PublicUser> {
    return this.auth.updateProfile(user.id, input);
  }

  /**
   * Changement de mot de passe.
   *
   * La session courante est réémise après coup : fermer toutes les sessions,
   * y compris celle qui vient de faire le changement, déconnecterait celui qui
   * sécurise son compte — et l'inciterait à ne plus le faire.
   */
  @Post('change-password')
  @Throttle(5, 900)
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body(zodBody(changePasswordSchema)) input: ChangePasswordInput,
  ): Promise<{ message: string }> {
    await this.auth.changePassword(user.id, input.currentPassword, input.password);

    const tokens = await this.auth.reissueSession(user.id, contextOf(request));
    setAuthCookies(response, tokens);

    return {
      message: 'Mot de passe modifié. Les autres sessions ont été fermées.',
    };
  }
}

function contextOf(request: Request): { userAgent?: string; ip?: string } {
  const userAgent = request.headers['user-agent'];
  return {
    ...(typeof userAgent === 'string' ? { userAgent } : {}),
    ...(request.ip ? { ip: request.ip } : {}),
  };
}

/**
 * `httpOnly` met le jeton hors de portée de tout script — c'est la protection
 * qui compte face à une injection. `sameSite: lax` bloque l'envoi automatique
 * depuis un site tiers, donc le CSRF sur les navigations. `secure` est actif
 * partout sauf en développement, où l'API tourne en clair sur localhost.
 */
function setAuthCookies(response: Response, tokens: IssuedTokens): void {
  const secure = process.env['NODE_ENV'] === 'production';

  response.cookie(ACCESS_COOKIE, tokens.accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: tokens.accessExpiresInSeconds * 1000,
    path: '/',
  });

  response.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    expires: tokens.refreshExpiresAt,
    // Le jeton de rafraîchissement ne part que vers la route qui s'en sert :
    // il n'a aucune raison d'accompagner chaque appel d'API.
    path: '/api/v1/auth',
  });
}

function clearAuthCookies(response: Response): void {
  response.clearCookie(ACCESS_COOKIE, { path: '/' });
  response.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
}
