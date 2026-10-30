import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class LoginCedulaDto {
  @IsString()
  @IsNotEmpty()
  cedula: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  secret: string; // PIN inicial o contraseña

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  platform?: string;
}
