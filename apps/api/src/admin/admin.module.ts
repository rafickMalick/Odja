import { Module } from '@nestjs/common';

import { LedgerService } from '../ledger/ledger.service';
import { BackOfficeController } from './back-office.controller';
import { BackOfficeService } from './back-office.service';

@Module({
  controllers: [BackOfficeController],
  providers: [BackOfficeService, LedgerService],
})
export class AdminModule {}
