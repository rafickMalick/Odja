import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { CheckoutModule } from '../checkout/checkout.module';
import { MakerModule } from '../makers/maker.module';
import { OrdersModule } from '../orders/orders.module';
import { SchedulerService } from './scheduler.service';

/* Validation, sous-commandes et paiements viennent d'OrdersModule ; les
   factures, de CheckoutModule. */
@Module({
  imports: [ScheduleModule.forRoot(), OrdersModule, CheckoutModule, MakerModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
