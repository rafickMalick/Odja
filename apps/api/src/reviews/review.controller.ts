import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  customerReviewSchema,
  moderateReviewSchema,
  type AdminReviewView,
  type CustomerReviewInput,
  type ModerateReviewInput,
  type OwnReviewView,
  type ProductReviews,
  type ReviewStatus,
} from '@oja/contracts';

import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Throttle } from '../common/rate-limit.guard';
import { zodBody } from '../common/zod.pipe';
import { ReviewService } from './review.service';

const STATUSES: ReviewStatus[] = ['PENDING', 'PUBLISHED', 'REJECTED'];

@Controller()
export class ReviewController {
  constructor(private readonly reviews: ReviewService) {}

  /** L'acheteur note une pièce reçue. Ouvert à tout compte : la propriété fait foi. */
  @Post('order-lines/:id/review')
  @Throttle(20, 3_600)
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') orderLineId: string,
    @Body(zodBody(customerReviewSchema)) input: CustomerReviewInput & { rating: number },
  ): Promise<OwnReviewView> {
    return this.reviews.create(user.id, orderLineId, input);
  }

  @Public()
  @Get('catalog/products/:slug/reviews')
  async forProduct(@Param('slug') slug: string): Promise<ProductReviews> {
    return this.reviews.forProduct(slug);
  }
}

@Controller('admin/reviews')
@Roles('ADMIN')
export class ReviewAdminController {
  constructor(private readonly reviews: ReviewService) {}

  @Get()
  async list(@Query('status') status?: string): Promise<AdminReviewView[]> {
    const wanted = STATUSES.includes(status as ReviewStatus) ? (status as ReviewStatus) : 'PENDING';
    return this.reviews.listForModeration(wanted);
  }

  @Post(':id/moderate')
  @HttpCode(200)
  async moderate(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(moderateReviewSchema)) input: ModerateReviewInput,
  ): Promise<AdminReviewView> {
    return this.reviews.moderate(id, admin.id, input);
  }
}
