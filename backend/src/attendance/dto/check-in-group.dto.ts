import { Type } from 'class-transformer';
import { IsString, ValidateNested } from 'class-validator';
import { GpsDto } from './check-in.dto';

export class CheckInGroupDto {
  @IsString()
  nonce: string;

  @IsString()
  hmacSignature: string;

  @IsString()
  deviceId: string;

  @ValidateNested()
  @Type(() => GpsDto)
  gps: GpsDto;
}
