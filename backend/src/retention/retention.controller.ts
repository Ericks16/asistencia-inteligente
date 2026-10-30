import { Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RetentionService } from './retention.service';

@Controller('retention')
export class RetentionController {
  constructor(
    private readonly retention: RetentionService,
    private readonly config: ConfigService,
  ) {}

  @Post('purge')
  purge(
    @Headers('x-cron-secret') headerSecret?: string,
    @Headers('authorization') authorization?: string,
  ) {
    const expected = this.config.get('CRON_SECRET');
    const bearerSecret = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : undefined;
    const secret = headerSecret ?? bearerSecret;
    if (!expected || secret !== expected) {
      throw new UnauthorizedException('CRON_SECRET inválido');
    }
    return this.retention.purgeExpired();
  }
}
