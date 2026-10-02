import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AdminBootstrapService } from './admin-bootstrap.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    OtpService,
    EmailVerificationService,
    AdminBootstrapService,
  ],
  // TokenService est exporté parce que le garde global d'authentification
  // s'en sert pour valider chaque requête.
  exports: [TokenService, PasswordService, OtpService, EmailVerificationService],
})
export class AuthModule {}
