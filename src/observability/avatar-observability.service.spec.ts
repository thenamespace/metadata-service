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
  service.onModuleInit();
  return service;
}

describe('AvatarObservabilityService', () => {
  it('requires a strong token only when metrics are enabled', () => {
    expect(() =>
      createService({
        AVATAR_METRICS_ENABLED: 'true',
        AVATAR_METRICS_TOKEN: 'short',
      }),
    ).toThrow('at least 32 characters');
  });

  it('keeps exact names and signed domains out of Prometheus labels', async () => {
    const service = createService({
      AVATAR_METRICS_ENABLED: 'true',
      AVATAR_METRICS_TOKEN: '01234567890123456789012345678901',
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
