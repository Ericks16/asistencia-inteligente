import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { RekognitionFaceService } from './face-recognition.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, RekognitionFaceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
