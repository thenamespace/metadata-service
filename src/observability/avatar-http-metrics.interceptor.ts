import {
  CallHandler,
  ExecutionContext,
  Injectable,
  HttpException,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AvatarObservabilityService } from './avatar-observability.service';

interface FastifyRequest {
  method: string;
  routeOptions?: { url?: string };
}

interface FastifyReply {
  statusCode: number;
}

@Injectable()
export class AvatarHttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly observability: AvatarObservabilityService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.observability.isEnabled()) return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const startedAt = process.hrtime.bigint();
    return next.handle().pipe(
      tap({
        next: () => this.record(request, reply, startedAt),
        error: (error: unknown) => {
          const statusCode =
            error instanceof HttpException ? error.getStatus() : 500;
          this.record(request, { statusCode }, startedAt);
        },
      }),
    );
  }

  private record(
    request: FastifyRequest,
    reply: FastifyReply,
    startedAt: bigint,
  ): void {
    const duration = Number(process.hrtime.bigint() - startedAt) / 1e9;
    this.observability.recordHttp(
      request.method,
      request.routeOptions?.url ?? 'unknown',
      reply.statusCode,
      duration,
    );
  }
}
