import { Module } from '@nestjs/common';

import { LedgerService } from '../ledger/ledger.service';
import { LogisticsModule } from '../logistics/logistics.module';
import { PaymentsModule } from '../payments/payments.module';
import {
  JobsAdminController,
  MakerOrdersController,
  MakerWalletController,
  OrderValidationController,
  OrdersAdminController,
  PaymentAdminController,
} from './orders.controller';
import { SubOrderService } from './sub-order.service';
import { ValidationService } from './validation.service';

@Module({
  imports: [LogisticsModule, PaymentsModule],
  controllers: [
    MakerOrdersController,
    MakerWalletController,
    OrderValidationController,
    PaymentAdminController,
    OrdersAdminController,
    JobsAdminController,
  ],
  providers: [SubOrderService, ValidationService, LedgerService],
  exports: [SubOrderService, ValidationService, LedgerService, PaymentsModule],
})
export class OrdersModule {}
