import { Global, Module } from '@nestjs/common';
import { AvatarHttpMetricsInterceptor } from './avatar-http-metrics.interceptor';
import { AvatarMetricsController } from './avatar-metrics.controller';
import { AvatarObservabilityService } from './avatar-observability.service';

@Global()
@Module({
  controllers: [AvatarMetricsController],
  providers: [AvatarObservabilityService, AvatarHttpMetricsInterceptor],
  exports: [AvatarObservabilityService, AvatarHttpMetricsInterceptor],
})
export class AvatarObservabilityModule {}
