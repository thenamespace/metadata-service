import { Controller, Get, HttpException, HttpStatus, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AvatarObservabilityService } from './avatar-observability.service';

interface MetricsReply {
  code(status: number): MetricsReply;
  header(name: string, value: string): MetricsReply;
  send(payload?: string): unknown;
}

@ApiExcludeController()
@Controller('metrics')
export class AvatarMetricsController {
  constructor(private readonly observability: AvatarObservabilityService) {}

  @Get()
  async getMetrics(
    @Res() reply: MetricsReply,
  ): Promise<unknown> {
    if (!this.observability.isEnabled()) {
      throw new HttpException('Not Found', HttpStatus.NOT_FOUND);
    }
    return reply
      .code(HttpStatus.OK)
      .header('Cache-Control', 'no-store')
      .header('Content-Type', this.observability.contentType())
      .send(await this.observability.metrics());
  }
}
