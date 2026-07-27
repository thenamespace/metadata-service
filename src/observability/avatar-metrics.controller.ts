import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Req,
  Res,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { ApiExcludeController } from '@nestjs/swagger';
import { AvatarObservabilityService } from './avatar-observability.service';

interface MetricsRequest {
  headers: { authorization?: string | string[] };
}

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
    @Req() request: MetricsRequest,
    @Res() reply: MetricsReply,
  ): Promise<unknown> {
    if (!this.observability.isEnabled()) {
      throw new HttpException('Not Found', HttpStatus.NOT_FOUND);
    }
    const raw = request.headers.authorization;
    const authorization = Array.isArray(raw) ? raw[0] : raw;
    const supplied =
      authorization?.startsWith('Bearer ') === true
        ? authorization.slice(7)
        : '';
    const expected = this.observability.getToken();
    const suppliedBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(expected);
    const valid =
      suppliedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(suppliedBuffer, expectedBuffer);
    if (!valid) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
    return reply
      .code(HttpStatus.OK)
      .header('Cache-Control', 'no-store')
      .header('Content-Type', this.observability.contentType())
      .send(await this.observability.metrics());
  }
}
