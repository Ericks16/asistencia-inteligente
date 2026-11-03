import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AuditModule } from '../audit/audit.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [AuditModule, StorageModule],
  controllers: [AdminController],
})
export class AdminModule {}
