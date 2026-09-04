import { Global, Module } from '@nestjs/common';

import { EmailService } from './email.service';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';
import { SmsService } from './sms.service';

/* Module global : les avis métier partent de partout — commandes, logistique,
   modération, réclamations. Les importer un à un ferait dépendre chaque module
   des notifications, alors que c'est l'inverse qui a du sens. Le contrôleur de
   lecture in-app y vit aussi : il n'a de dépendance que sur ce service. */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [SmsService, EmailService, NotificationService],
  exports: [SmsService, EmailService, NotificationService],
})
export class NotificationsModule {}
