import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class GpsDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @IsNumber()
  @Min(0)
  accuracyM: number;

  @IsString()
  provider: string; // gps | fused | network

  @IsBoolean()
  isMock: boolean;

  @IsOptional()
  @IsNumber()
  altitudeM?: number;

  @IsOptional()
  @IsNumber()
  speedMps?: number;
}

export class CheckInDto {
  @IsString()
  nonce: string;

  @IsString()
  hmacSignature: string;

  @IsString()
  livenessToken: string;

  @IsString()
  deviceId: string;

  @IsOptional()
  @IsString()
  clientTimestamp?: string;

  @ValidateNested()
  @Type(() => GpsDto)
  gps: GpsDto;
}
