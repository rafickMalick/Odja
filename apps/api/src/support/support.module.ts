import { Module } from '@nestjs/common';

import { SupportAdminController, SupportController } from './support.controller';
import { SupportService } from './support.service';

/* NotificationService vient du module de notifications, global. */
@Module({
  controllers: [SupportController, SupportAdminController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
