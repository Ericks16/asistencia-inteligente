import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';

type HttpRequest = {
  method?: string;
  url?: string;
};

type HttpResponse = {
  status(code: number): HttpResponse;
  json(body: object): void;
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    const request = host.switchToHttp().getRequest<HttpRequest>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const exceptionResponse = exception instanceof HttpException ? exception.getResponse() : null;
    const message = typeof exceptionResponse === 'object' && exceptionResponse !== null && 'message' in exceptionResponse
      ? (exceptionResponse as { message: string | string[] }).message
      : exception instanceof Error ? exception.message : 'Error interno del servidor';
    const requestId = randomUUID();

    if (status >= 500) {
      this.logger.error(
        `${request.method ?? 'UNKNOWN'} ${request.url ?? 'UNKNOWN'} [${requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      path: request.url ?? 'unknown',
      timestamp: new Date().toISOString(),
      requestId,
    });
  }
}
