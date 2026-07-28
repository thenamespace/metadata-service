import { ConfigService } from '@nestjs/config';
import { AvatarObservabilityService } from './avatar-observability.service';
import { FileType } from '../common/enums/file-type.enum';
import { Network } from '../common/enums/network.enum';

function createService(
  env: Record<string, string> = {},
): AvatarObservabilityService {
  const service = new AvatarObservabilityService({
    get: (key: string) => env[key],
  } as ConfigService);
  return service;
}

describe('AvatarObservabilityService', () => {
  it('enables metrics without requiring a token', () => {
    expect(() =>
      createService({ AVATAR_METRICS_ENABLED: 'true' }),
    ).not.toThrow();
  });

  it('keeps exact names and signed domains out of Prometheus labels', async () => {
    const service = createService({
      AVATAR_METRICS_ENABLED: 'true',
    });
    service.recordMedia(
      FileType.AVATAR,
      Network.MAINNET,
      'upload',
      'created_active',
    );

    const metrics = await service.metrics();
    expect(metrics).not.toContain('alice.project.eth');
    expect(metrics).not.toContain('app.example.com');
  });
});
