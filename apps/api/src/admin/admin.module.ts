import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { LedgerService } from '../ledger/ledger.service';
import { AdminTeamController } from './admin-team.controller';
import { AdminTeamService } from './admin-team.service';
import { BackOfficeController } from './back-office.controller';
import { BackOfficeService } from './back-office.service';

@Module({
  // AuthModule pour TokenService : retirer un admin ferme ses sessions.
  imports: [AuthModule],
  controllers: [BackOfficeController, AdminTeamController],
  providers: [BackOfficeService, LedgerService, AdminTeamService],
})
export class AdminModule {}
