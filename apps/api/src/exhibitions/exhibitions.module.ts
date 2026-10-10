import { Module } from '@nestjs/common';

import { PaymentsModule } from '../payments/payments.module';
import { ExhibitionAdminService } from './exhibition-admin.service';
import {
  ExhibitionPassAdminController,
  ExhibitionPassController,
} from './exhibition-pass.controller';
import { ExhibitionPassService } from './exhibition-pass.service';
import {
  ExhibitionAdminController,
  ExhibitionOrganizerController,
  ExhibitionPublicController,
} from './exhibition.controller';
import { ExhibitionService } from './exhibition.service';

/** Expositions physiques, numériques et hybrides (cahier des évolutions, § 6 à 10). */
@Module({
  imports: [PaymentsModule],
  /* La billetterie se déclare avant la page publique : `passes/mine` ne doit
     pas être lu comme le slug d'une exposition. */
  controllers: [
    ExhibitionPassController,
    ExhibitionPublicController,
    ExhibitionOrganizerController,
    ExhibitionPassAdminController,
    ExhibitionAdminController,
  ],
  providers: [ExhibitionService, ExhibitionAdminService, ExhibitionPassService],
  exports: [ExhibitionService],
})
export class ExhibitionsModule {}
