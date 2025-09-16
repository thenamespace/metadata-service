/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ErrorCodes } from '../enums/error-codes.enum';

type ErrorBody = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown> | string | null;
  };
  timestamp: string;
  path: string;
};

@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalHttpExceptionFilter.name);
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const reply = ctx.getResponse<FastifyReply>();

    const normalized = this.normalizeException(exception);
    const { status, code, message, details } = normalized;

    const body: ErrorBody = {
      error: {
        code,
        message,
        details: details ?? null,
      },
      timestamp: new Date().toISOString(),
      path: request?.url ?? '',
    };

    this.logger.warn({
      msg: 'HTTP exception',
      status,
      code,
      message,
      details,
      method: (request as any)?.method,
      url: (request as any)?.url,
    });

    void reply.status(status).send(body);
  }

  private normalizeException(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown> | string | null;
  } {
    // HttpException from Nest
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse() as
        | string
        | {
            message?: string | string[];
            error?: string;
            statusCode?: number;
            [k: string]: unknown;
          };

      // Handle ValidationPipe errors and standard HttpException shapes
      if (typeof response === 'string') {
        return {
          status,
          code: this.statusToDefaultCode(status),
          message: response,
        };
      }

      const msg = Array.isArray(response?.message)
        ? response.message.join('; ')
        : (response?.message ?? response?.error ?? 'Unexpected error');

      // Safely extract details without circular references
      const details: Record<string, unknown> = {};
      try {
        // Only copy safe, serializable properties
        for (const [key, value] of Object.entries(response)) {
          if (key !== 'message' && key !== 'statusCode' && key !== 'error') {
            // Skip circular references and complex objects
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
              details[key] = value;
            } else if (Array.isArray(value)) {
              // Only include arrays of primitives
              if (value.every(item => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')) {
                details[key] = value;
              }
            }
          }
        }
      } catch {
        // If there's any issue with serialization, just skip details
        // This prevents circular reference errors
      }

      return {
        status,
        code: this.statusToDefaultCode(status),
        message: msg,
        details: Object.keys(details).length ? details : undefined,
      };
    }

    // Unknown / unhandled errors
    const hasMessage =
      typeof exception === 'object' &&
      exception !== null &&
      'message' in exception;
    const rawMessage = hasMessage
      ? (exception as { message?: unknown }).message
      : undefined;
    const message =
      typeof rawMessage === 'string' ? rawMessage : 'Internal server error';
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCodes.INTERNAL_SERVER_ERROR,
      message,
    };
  }

  private statusToDefaultCode(status: number): string {
    switch (status as HttpStatus) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCodes.BAD_REQUEST;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCodes.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCodes.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCodes.NOT_FOUND;
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return ErrorCodes.PAYLOAD_TOO_LARGE;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCodes.TOO_MANY_REQUESTS;
      default:
        return ErrorCodes.INTERNAL_SERVER_ERROR;
    }
  }
}
