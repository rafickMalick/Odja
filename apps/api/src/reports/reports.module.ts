import { Module } from '@nestjs/common';

import { MakerModule } from '../makers/maker.module';
import { ReportAdminController, ReportController } from './report.controller';
import { ReportService } from './report.service';

/** Signalements de contenus et tableau de bord des évolutions créatives. */
@Module({
  imports: [MakerModule],
  controllers: [ReportController, ReportAdminController],
  providers: [ReportService],
})
export class ReportsModule {}
