import { Module } from '@nestjs/common';

import { AddressController } from '../addresses/address.controller';
import { AddressService } from '../addresses/address.service';
import { CartController } from '../cart/cart.controller';
import { CartService } from '../cart/cart.service';
import { PaymentsModule } from '../payments/payments.module';
import { CheckoutController, InvoiceAdminController } from './checkout.controller';
import { InvoiceService } from './invoice.service';
import { OrderService } from './order.service';
import { PromoAdminController } from './promo.controller';
import { PromoService } from './promo.service';
import { QuoteService } from './quote.service';

@Module({
  imports: [PaymentsModule],
  controllers: [
    CartController,
    AddressController,
    CheckoutController,
    InvoiceAdminController,
    PromoAdminController,
  ],
  providers: [
    CartService,
    AddressService,
    QuoteService,
    PromoService,
    InvoiceService,
    OrderService,
  ],
  exports: [CartService, InvoiceService],
})
export class CheckoutModule {}
