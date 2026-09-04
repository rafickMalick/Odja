import { Module } from '@nestjs/common';

import { LedgerService } from '../ledger/ledger.service';
import { DisputeAdminController, DisputeController } from './dispute.controller';
import { DisputeService } from './dispute.service';

@Module({
  controllers: [DisputeController, DisputeAdminController],
  providers: [DisputeService, LedgerService],
  exports: [DisputeService],
})
export class DisputeModule {}
