import { ERROR_CODES, type ErrorCode } from '../../config/constants.js';

export interface ErrorDetail {
  field: string;
  issue: string;
}

export interface AppErrorOptions {
  status: number;
  code: ErrorCode;
  message: string;
  details?: ErrorDetail[];
  retryAfter?: number;
  cause?: unknown;
}

/**
 * Operational error mapping 1:1 to the API-Spec.md custom error envelope.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: ErrorDetail[];
  readonly retryAfter?: number;
  readonly isOperational = true;

  constructor({ status, code, message, details, retryAfter, cause }: AppErrorOptions) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter;
  }

  static badRequest(
    message = 'The request is malformed.',
    code: ErrorCode = ERROR_CODES.INVALID_REQUEST,
    details?: ErrorDetail[],
  ): AppError {
    return new AppError({ status: 400, code, message, details });
  }

  static malformedJson(): AppError {
    return new AppError({
      status: 400,
      code: ERROR_CODES.MALFORMED_JSON,
      message: 'The request body is not valid JSON.',
    });
  }

  static unauthorized(message = 'Authentication is required to access this resource.'): AppError {
    return new AppError({ status: 401, code: ERROR_CODES.AUTHENTICATION_REQUIRED, message });
  }

  static forbidden(
    message = 'You do not have permission to perform this action.',
    code: ErrorCode = ERROR_CODES.ACCESS_DENIED,
  ): AppError {
    return new AppError({ status: 403, code, message });
  }

  static notFound(
    message = 'The requested resource was not found.',
    code: ErrorCode = ERROR_CODES.RESOURCE_NOT_FOUND,
  ): AppError {
    return new AppError({ status: 404, code, message });
  }

  static conflict(
    message = 'The request conflicts with the current state of the resource.',
    code: ErrorCode = ERROR_CODES.RESOURCE_STATE_CONFLICT,
  ): AppError {
    return new AppError({ status: 409, code, message });
  }

  static validation(details: ErrorDetail[], message = 'The submission payload failed validation checks.'): AppError {
    return new AppError({ status: 422, code: ERROR_CODES.VALIDATION_FAILED, message, details });
  }

  static tooManyRequests(
    retryAfter?: number,
    message = 'Too many requests. Please wait before trying again.',
  ): AppError {
    return new AppError({ status: 429, code: ERROR_CODES.RATE_LIMIT_EXCEEDED, message, retryAfter });
  }

  static unavailable(
    message = 'A required service is temporarily unavailable. Please try again shortly.',
    retryAfter?: number,
  ): AppError {
    return new AppError({ status: 503, code: ERROR_CODES.SERVICE_UNAVAILABLE, message, retryAfter });
  }
}
