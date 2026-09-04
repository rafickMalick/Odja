import { Module } from '@nestjs/common';

import { MakerModule } from '../makers/maker.module';
import { CourierService } from './courier.service';
import {
  CourierAdminController,
  CourierController,
  LogisticsAdminController,
} from './logistics.controller';
import { ShipmentEventsBus } from './shipment-events.bus';
import { ShipmentService } from './shipment.service';
import { TrackingController } from './tracking.controller';

/* Le service des pièces justificatives vit dans le module créateur : il sert
   les deux profils, et le dupliquer ferait diverger la règle qui interdit de
   délivrer une URL de lecture hors administration. */
@Module({
  imports: [MakerModule],
  controllers: [
    CourierController,
    CourierAdminController,
    LogisticsAdminController,
    TrackingController,
  ],
  providers: [ShipmentService, CourierService, ShipmentEventsBus],
  exports: [ShipmentService, CourierService],
})
export class LogisticsModule {}
