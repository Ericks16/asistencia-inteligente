import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const exceptionResponse = exception instanceof HttpException ? exception.getResponse() : null;
    const message = typeof exceptionResponse === 'object' && exceptionResponse !== null && 'message' in exceptionResponse
      ? (exceptionResponse as { message: string | string[] }).message
      : exception instanceof Error ? exception.message : 'Error interno del servidor';
    const requestId = randomUUID();

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} [${requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
      requestId,
    });
  }
}
