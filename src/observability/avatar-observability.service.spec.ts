import { AvatarObservabilityService } from './avatar-observability.service';
import { FileType } from '../common/enums/file-type.enum';
import { Network } from '../common/enums/network.enum';

describe('AvatarObservabilityService', () => {
  it('records metrics without configuration', async () => {
    const service = new AvatarObservabilityService();

    service.recordMedia(
      FileType.AVATAR,
      Network.MAINNET,
      'upload',
      'created_active',
    );

    await expect(service.metrics()).resolves.toContain(
      'avatar_service_media_operations_total',
    );
  });

  it('keeps exact names and signed domains out of Prometheus labels', async () => {
    const service = new AvatarObservabilityService();
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
