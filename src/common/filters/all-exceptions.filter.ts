import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { AppException } from '../exceptions/app.exception';
import { ErrorCodes } from '../constants/error-codes';

const STATUS_TO_CODE: Record<number, string> = {
  400: ErrorCodes.VALIDATION_ERROR,
  401: ErrorCodes.UNAUTHORIZED,
  402: ErrorCodes.SUBSCRIPTION_EXPIRED,
  403: ErrorCodes.FORBIDDEN,
  404: ErrorCodes.NOT_FOUND,
  409: ErrorCodes.CONFLICT,
  429: ErrorCodes.TOO_MANY_REQUESTS,
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
      return;
    }
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCodes.INTERNAL_ERROR;
    let message = 'Ichki server xatosi';
    let details: unknown = null;

    if (exception instanceof AppException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      code = STATUS_TO_CODE[status] ?? ErrorCodes.INTERNAL_ERROR;
      if (typeof response === 'string') {
        message = response;
      } else if (response && typeof response === 'object') {
        const r = response as Record<string, unknown>;
        message = Array.isArray(r.message)
          ? (r.message as string[]).join('; ')
          : ((r.message as string) ?? exception.message);
        if (r.code && typeof r.code === 'string') code = r.code;
        details = r.details ?? (Array.isArray(r.message) ? r.message : null);
      }
    } else {
      this.logger.error(
        exception instanceof Error ? (exception.stack ?? exception.message) : String(exception),
      );
    }

    void reply.status(status).send({
      success: false,
      data: null,
      error: { code, message, details: details ?? null },
    });
  }
}
