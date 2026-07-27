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
  it('uses the longest configured ENS parent on label boundaries', () => {
    const service = createService({
      AVATAR_PARENT_NAMES: 'project.eth, alice.project.eth',
    });

    expect(service.resolveParent('x.alice.project.eth')).toBe(
      'alice.project.eth',
    );
    expect(service.resolveParent('notproject.eth')).toBe('unknown');
  });

  it('rejects invalid parent configuration', () => {
    expect(() =>
      createService({ AVATAR_PARENT_NAMES: 'not a valid ens name' }),
    ).toThrow('Invalid ENS parent');
  });

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
      AVATAR_PARENT_NAMES: 'project.eth',
    });
    service.recordMedia(
      FileType.AVATAR,
      Network.MAINNET,
      'upload',
      'created_active',
      service.resolveParent('alice.project.eth'),
    );

    const metrics = await service.metrics();
    expect(metrics).toContain('parent_group="project.eth"');
    expect(metrics).not.toContain('alice.project.eth');
    expect(metrics).not.toContain('app.example.com');
  });
});
