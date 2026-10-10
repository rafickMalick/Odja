import { Module } from '@nestjs/common';

import {
  MakerAdminController,
  MakerController,
  MakerPublicController,
  VisibilityPlanAdminController,
} from './maker.controller';
import { KycDocumentService } from './kyc-document.service';
import { MakerService } from './maker.service';
import { VisibilityService } from './visibility.service';

@Module({
  controllers: [
    MakerPublicController,
    MakerController,
    MakerAdminController,
    VisibilityPlanAdminController,
  ],
  providers: [MakerService, KycDocumentService, VisibilityService],
  exports: [MakerService, KycDocumentService, VisibilityService],
})
export class MakerModule {}
