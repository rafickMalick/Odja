import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { addressSchema, type AddressInput, type PublicAddress } from '@oja/contracts';

import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { zodBody } from '../common/zod.pipe';
import { AddressService } from './address.service';

@Controller('me/addresses')
export class AddressController {
  constructor(private readonly addresses: AddressService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<PublicAddress[]> {
    return this.addresses.list(user.id);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(addressSchema)) input: AddressInput,
  ): Promise<PublicAddress> {
    return this.addresses.create(user.id, input);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(addressSchema.partial())) input: Partial<AddressInput>,
  ): Promise<PublicAddress> {
    return this.addresses.update(user.id, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.addresses.remove(user.id, id);
  }
}
