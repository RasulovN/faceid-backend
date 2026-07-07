import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCodes } from '../constants/error-codes';

/** Kontrakt envelope'iga mos xato: { code, message, details } */
export class AppException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus,
    public readonly details: unknown = null,
  ) {
    super({ code, message, details }, status);
  }

  static notFound(message = 'Topilmadi'): AppException {
    return new AppException(ErrorCodes.NOT_FOUND, message, HttpStatus.NOT_FOUND);
  }

  static forbidden(message = 'Ruxsat yo‘q'): AppException {
    return new AppException(ErrorCodes.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }

  static unauthorized(message = 'Avtorizatsiyadan o‘tilmagan'): AppException {
    return new AppException(ErrorCodes.UNAUTHORIZED, message, HttpStatus.UNAUTHORIZED);
  }

  static conflict(message: string, details: unknown = null): AppException {
    return new AppException(ErrorCodes.CONFLICT, message, HttpStatus.CONFLICT, details);
  }

  static validation(message: string, details: unknown = null): AppException {
    return new AppException(ErrorCodes.VALIDATION_ERROR, message, HttpStatus.BAD_REQUEST, details);
  }
}
