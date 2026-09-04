import { Module } from '@nestjs/common';

import {
  MakerAdminController,
  MakerController,
  MakerPublicController,
} from './maker.controller';
import { KycDocumentService } from './kyc-document.service';
import { MakerService } from './maker.service';

@Module({
  controllers: [MakerPublicController, MakerController, MakerAdminController],
  providers: [MakerService, KycDocumentService],
  exports: [MakerService, KycDocumentService],
})
export class MakerModule {}
