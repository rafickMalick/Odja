import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { OrdersModule } from '../orders/orders.module';
import { SchedulerService } from './scheduler.service';

/* Les trois services dont l'ordonnanceur a besoin sont tous exportés par
   OrdersModule : validation, sous-commandes et paiements. */
@Module({
  imports: [ScheduleModule.forRoot(), OrdersModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
