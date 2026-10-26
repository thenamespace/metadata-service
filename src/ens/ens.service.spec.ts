import { ConfigService } from '@nestjs/config';
import { getEnsAddress } from 'viem/ens';
import { Network } from '../common/enums/network.enum';
import { FileType } from '../common/enums/file-type.enum';
import { AvatarObservabilityService } from '../observability/avatar-observability.service';
import { getEnsV2Authorization } from './ens-v2-authorization';
import { EnsService } from './ens.service';

jest.mock('viem/ens', () => ({
  ...jest.requireActual<typeof import('viem/ens')>('viem/ens'),
  getEnsAddress: jest.fn(),
}));
jest.mock('./ens-v2-authorization', () => ({
  getEnsV2Authorization: jest.fn(),
}));

const wallet = '0x0000000000000000000000000000000000000001';
const config = {
  ENS_SEPOLIA_UNIVERSAL_HELPER: '0x0000000000000000000000000000000000000030',
  ENS_SEPOLIA_V1_RESOLVER: '0x0000000000000000000000000000000000000040',
};
const request = {
  subname: 'example.eth',
  network: Network.SEPOLIA,
  address: wallet,
  recordKey: FileType.AVATAR,
};

function service(settings: Record<string, string> = {}) {
  return new EnsService(new ConfigService(settings), {
    recordEnsLookup: jest.fn(),
  } as unknown as AvatarObservabilityService);
}

describe('ENS upload authorization routing', () => {
  beforeEach(() => jest.resetAllMocks());

  it.each([
    [wallet, 'allowed'],
    ['0x0000000000000000000000000000000000000002', 'denied'],
    [null, 'pending'],
  ] as const)(
    'preserves legacy address behavior for %s',
    async (resolved, expected) => {
      jest.mocked(getEnsAddress).mockResolvedValue(resolved);
      await expect(service().getUploadAuthorization(request)).resolves.toBe(
        expected,
      );
      expect(getEnsV2Authorization).not.toHaveBeenCalled();
    },
  );

  it('keeps mainnet on the legacy path when Sepolia V2 is configured', async () => {
    jest.mocked(getEnsAddress).mockResolvedValue(wallet);
    await expect(
      service(config).getUploadAuthorization({
        ...request,
        network: Network.MAINNET,
      }),
    ).resolves.toBe('allowed');
    expect(getEnsV2Authorization).not.toHaveBeenCalled();
  });

  it('uses the legacy path for a confirmed V1 mirror route on Sepolia', async () => {
    jest.mocked(getEnsV2Authorization).mockResolvedValue(null);
    jest.mocked(getEnsAddress).mockResolvedValue(wallet);
    await expect(service(config).getUploadAuthorization(request)).resolves.toBe(
      'allowed',
    );
    expect(getEnsAddress).toHaveBeenCalledTimes(1);
  });

  it.each(['allowed', 'denied', 'pending'] as const)(
    'preserves the V2 %s decision without address fallback',
    async (decision) => {
      jest.mocked(getEnsV2Authorization).mockResolvedValue(decision);
      jest.mocked(getEnsAddress).mockResolvedValue(wallet);
      await expect(
        service(config).getUploadAuthorization(request),
      ).resolves.toBe(decision);
      expect(getEnsAddress).not.toHaveBeenCalled();
    },
  );

  it('does not fall back after a V2 lookup failure', async () => {
    const failure = new Error('RPC unavailable');
    jest.mocked(getEnsV2Authorization).mockRejectedValue(failure);
    await expect(service(config).getUploadAuthorization(request)).rejects.toBe(
      failure,
    );
    expect(getEnsAddress).not.toHaveBeenCalled();
  });

  it('rejects incomplete V2 configuration at startup', () => {
    expect(() =>
      service({
        ENS_SEPOLIA_UNIVERSAL_HELPER: config.ENS_SEPOLIA_UNIVERSAL_HELPER,
      }),
    ).toThrow('ENS Sepolia V2 requires');
  });
});
