import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import {
  newsletterSubscribeSchema,
  type NewsletterReceipt,
  type NewsletterSubscribeInput,
} from '@oja/contracts';

import { Public } from '../auth/decorators/public.decorator';
import { Throttle } from '../common/rate-limit.guard';
import { zodBody } from '../common/zod.pipe';
import { NewsletterService } from './newsletter.service';

/**
 * Inscription à la newsletter, ouverte à tous.
 *
 * Mêmes protections que le formulaire de contact : 5 envois par heure et par
 * adresse, et le piège à robots `website`.
 */
@Controller('newsletter')
export class NewsletterController {
  private readonly logger = new Logger(NewsletterController.name);

  constructor(private readonly newsletter: NewsletterService) {}

  @Public()
  @Throttle(5, 3_600)
  @Post()
  @HttpCode(201)
  async subscribe(
    @Body(zodBody(newsletterSubscribeSchema)) input: NewsletterSubscribeInput,
  ): Promise<NewsletterReceipt> {
    if (input.website?.trim()) {
      this.logger.warn('Newsletter : piège à robots déclenché, inscription ignorée');
      return { subscribed: true };
    }
    return this.newsletter.subscribe(input.email);
  }
}
