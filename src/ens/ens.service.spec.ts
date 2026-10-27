import { ConfigService } from '@nestjs/config';
import { getEnsAddress } from 'viem/ens';
import { mainnet } from 'viem/chains';
import { Network } from '../common/enums/network.enum';
import { FileType } from '../common/enums/file-type.enum';
import { AvatarObservabilityService } from '../observability/avatar-observability.service';
import { getEnsV2Authorization } from './ens-v2-authorization';
import { EnsService } from './ens.service';
import { ENS_V2_CONTRACTS } from './ens-contracts';

jest.mock('./ens-contracts', () => ({
  ENS_V2_CONTRACTS: {
    ...jest.requireActual<typeof import('./ens-contracts')>('./ens-contracts')
      .ENS_V2_CONTRACTS,
  },
}));

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

const recordEnsLookup = jest.fn();

function service() {
  return new EnsService(new ConfigService(), {
    recordEnsLookup,
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
      expect(recordEnsLookup).toHaveBeenCalledTimes(1);
    },
  );

  it.each([FileType.AVATAR, FileType.HEADER])(
    'keeps mainnet %s authorization on the legacy path',
    async (recordKey) => {
      jest.mocked(getEnsAddress).mockResolvedValue(wallet);
      await expect(
        service().getUploadAuthorization({
          ...request,
          network: Network.MAINNET,
          recordKey,
        }),
      ).resolves.toBe('allowed');
      expect(getEnsV2Authorization).not.toHaveBeenCalled();
      expect(getEnsAddress).toHaveBeenCalledWith(expect.anything(), {
        name: request.subname,
      });
    },
  );

  it('does not reuse the legacy address cache on V2-enabled networks', async () => {
    const ens = service();
    jest.mocked(getEnsAddress).mockResolvedValue(wallet);
    await ens.getOwnerOrNull(request);
    jest.mocked(getEnsAddress).mockClear();
    jest.mocked(getEnsV2Authorization).mockResolvedValue('denied');
    await expect(ens.getUploadAuthorization(request)).resolves.toBe('denied');
    expect(getEnsAddress).not.toHaveBeenCalled();
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
      expect(recordEnsLookup).toHaveBeenCalledTimes(1);
      expect(recordEnsLookup).toHaveBeenCalledWith(
        Network.SEPOLIA,
        'not_applicable',
        decision,
        expect.any(Number),
      );
    },
  );

  it('does not fall back after a V2 lookup failure', async () => {
    const failure = new Error('RPC unavailable');
    jest.mocked(getEnsV2Authorization).mockRejectedValue(failure);
    await expect(service().getUploadAuthorization(request)).rejects.toBe(
      failure,
    );
    expect(getEnsAddress).not.toHaveBeenCalled();
    expect(recordEnsLookup).toHaveBeenCalledTimes(1);
    expect(recordEnsLookup).toHaveBeenCalledWith(
      Network.SEPOLIA,
      'not_applicable',
      'rpc_error',
      expect.any(Number),
    );
  });

  it('records invalid V2 names without making an RPC lookup', async () => {
    await expect(
      service().getUploadAuthorization({
        ...request,
        subname: 'bad name.eth',
      }),
    ).rejects.toThrow();
    expect(getEnsV2Authorization).not.toHaveBeenCalled();
    expect(recordEnsLookup).toHaveBeenCalledTimes(1);
    expect(recordEnsLookup).toHaveBeenCalledWith(
      Network.SEPOLIA,
      'not_applicable',
      'invalid_name',
      expect.any(Number),
    );
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

  describe('mainnet with a future verified deployment', () => {
    // Synthetic addresses exist only in the mocked deployment map.
    const mainnetContracts = {
      helper: '0x0000000000000000000000000000000000000030',
      v1Resolver: '0x0000000000000000000000000000000000000040',
      publicResolver: '0x0000000000000000000000000000000000000050',
    } as const;
    const mainnetRequest = { ...request, network: Network.MAINNET };

    beforeEach(() => {
      ENS_V2_CONTRACTS[Network.MAINNET] = mainnetContracts;
    });

    afterEach(() => {
      delete ENS_V2_CONTRACTS[Network.MAINNET];
    });

    it.each([FileType.AVATAR, FileType.HEADER])(
      'routes %s through the mainnet client and deployment',
      async (recordKey) => {
        jest.mocked(getEnsV2Authorization).mockResolvedValue('allowed');
        await expect(
          service().getUploadAuthorization({ ...mainnetRequest, recordKey }),
        ).resolves.toBe('allowed');
        expect(getEnsV2Authorization).toHaveBeenCalledWith(
          expect.objectContaining({ chain: mainnet }),
          mainnetContracts,
          request.subname,
          wallet,
          recordKey,
        );
        expect(getEnsAddress).not.toHaveBeenCalled();
      },
    );

    it.each(['allowed', 'denied', 'pending'] as const)(
      'preserves %s after a cached legacy authorization',
      async (decision) => {
        const ens = service();
        jest.mocked(getEnsAddress).mockResolvedValue(wallet);
        await ens.getOwnerOrNull(mainnetRequest);
        jest.mocked(getEnsAddress).mockClear();
        recordEnsLookup.mockClear();
        jest.mocked(getEnsV2Authorization).mockResolvedValue(decision);
        await expect(ens.getUploadAuthorization(mainnetRequest)).resolves.toBe(
          decision,
        );
        expect(getEnsAddress).not.toHaveBeenCalled();
        expect(recordEnsLookup).toHaveBeenCalledTimes(1);
        expect(recordEnsLookup).toHaveBeenCalledWith(
          Network.MAINNET,
          'not_applicable',
          decision,
          expect.any(Number),
        );
      },
    );

    it('propagates mainnet V2 failures without legacy fallback', async () => {
      const failure = new Error('Mainnet RPC unavailable');
      jest.mocked(getEnsV2Authorization).mockRejectedValue(failure);
      await expect(
        service().getUploadAuthorization(mainnetRequest),
      ).rejects.toBe(failure);
      expect(getEnsAddress).not.toHaveBeenCalled();
      expect(recordEnsLookup).toHaveBeenCalledWith(
        Network.MAINNET,
        'not_applicable',
        'rpc_error',
        expect.any(Number),
      );
    });
  });
});
