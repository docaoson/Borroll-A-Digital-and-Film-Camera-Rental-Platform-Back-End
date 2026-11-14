import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'Đã có lỗi xảy ra trên hệ thống. Vui lòng thử lại sau.';
    let details: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
        code = this.mapStatusToCode(status);
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, unknown>;
        code =
          typeof resObj.code === 'string'
            ? resObj.code
            : this.mapStatusToCode(status);
        message = typeof resObj.message === 'string' ? resObj.message : message;
        details =
          typeof resObj.details === 'object' && resObj.details !== null
            ? (resObj.details as Record<string, unknown>)
            : {};
      }
    } else {
      const errName =
        exception instanceof Error ? exception.name : 'UnknownError';
      const errCode =
        typeof (exception as { code?: unknown })?.code === 'string'
          ? ` [code=${(exception as { code: string }).code}]`
          : '';
      this.logger.error(`Unhandled exception: ${errName}${errCode}`);
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(exception);
      }
    }

    response.status(status).json({
      error: {
        code,
        message,
        details,
      },
    });
  }

  private mapStatusToCode(status: number): string {
    const codeMap: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
      [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
      [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.CONFLICT]: 'INVALID_STATUS_TRANSITION',
      [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
      [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
    };
    return codeMap[status] ?? 'INTERNAL_SERVER_ERROR';
  }
}
