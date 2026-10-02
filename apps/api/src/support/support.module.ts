import { Module } from '@nestjs/common';

import { ContactController } from './contact.controller';
import { SupportAdminController, SupportController } from './support.controller';
import { SupportService } from './support.service';

/* NotificationService vient du module de notifications, global. */
@Module({
  controllers: [SupportController, SupportAdminController, ContactController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
