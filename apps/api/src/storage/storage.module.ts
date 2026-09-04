import { Global, Module } from '@nestjs/common';

import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

/* Global : le catalogue, les dossiers KYC, la logistique et les réclamations
   ont tous besoin de résoudre une clé en URL. */
@Global()
@Module({
  controllers: [StorageController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
