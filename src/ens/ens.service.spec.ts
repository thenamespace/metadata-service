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
const request = {
  subname: 'example.eth',
  network: Network.SEPOLIA,
  address: wallet,
  recordKey: FileType.AVATAR,
};

function service() {
  return new EnsService(new ConfigService(), {
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
      await expect(
        service().getUploadAuthorization({
          ...request,
          network: Network.MAINNET,
        }),
      ).resolves.toBe(expected);
      expect(getEnsV2Authorization).not.toHaveBeenCalled();
    },
  );

  it('keeps mainnet on the legacy path', async () => {
    jest.mocked(getEnsAddress).mockResolvedValue(wallet);
    await expect(
      service().getUploadAuthorization({
        ...request,
        network: Network.MAINNET,
      }),
    ).resolves.toBe('allowed');
    expect(getEnsV2Authorization).not.toHaveBeenCalled();
  });

  it('uses the legacy path for a confirmed V1 mirror route on Sepolia', async () => {
    jest.mocked(getEnsV2Authorization).mockResolvedValue(null);
    jest.mocked(getEnsAddress).mockResolvedValue(wallet);
    await expect(service().getUploadAuthorization(request)).resolves.toBe(
      'allowed',
    );
    expect(getEnsAddress).toHaveBeenCalledTimes(1);
  });

  it.each(['allowed', 'denied', 'pending'] as const)(
    'preserves the V2 %s decision without address fallback',
    async (decision) => {
      jest.mocked(getEnsV2Authorization).mockResolvedValue(decision);
      jest.mocked(getEnsAddress).mockResolvedValue(wallet);
      await expect(service().getUploadAuthorization(request)).resolves.toBe(
        decision,
      );
      expect(getEnsAddress).not.toHaveBeenCalled();
    },
  );

  it('does not fall back after a V2 lookup failure', async () => {
    const failure = new Error('RPC unavailable');
    jest.mocked(getEnsV2Authorization).mockRejectedValue(failure);
    await expect(service().getUploadAuthorization(request)).rejects.toBe(
      failure,
    );
    expect(getEnsAddress).not.toHaveBeenCalled();
  });

  it('selects the V2 deployment automatically without environment configuration', async () => {
    jest.mocked(getEnsV2Authorization).mockResolvedValue('allowed');
    await expect(service().getUploadAuthorization(request)).resolves.toBe(
      'allowed',
    );
    expect(getEnsV2Authorization).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        helper: '0xd453e5bdb62cc3bea84341b1e306319c8ffd7dfe',
      }),
      request.subname,
      wallet,
      FileType.AVATAR,
    );
  });
});
