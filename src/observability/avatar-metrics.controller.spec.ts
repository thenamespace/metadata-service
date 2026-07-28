import { HttpStatus } from '@nestjs/common';
import { AvatarMetricsController } from './avatar-metrics.controller';
import { AvatarObservabilityService } from './avatar-observability.service';

describe('AvatarMetricsController', () => {
  it('returns metrics without authentication', async () => {
    const observability = {
      contentType: jest.fn().mockReturnValue('text/plain'),
      metrics: jest.fn().mockResolvedValue('metric 1'),
    } as unknown as AvatarObservabilityService;
    const reply = {
      code: jest.fn().mockReturnThis(),
      header: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };

    await new AvatarMetricsController(observability).getMetrics(reply);

    expect(reply.code).toHaveBeenCalledWith(HttpStatus.OK);
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(reply.header).toHaveBeenCalledWith('Content-Type', 'text/plain');
    expect(reply.send).toHaveBeenCalledWith('metric 1');
  });
});
