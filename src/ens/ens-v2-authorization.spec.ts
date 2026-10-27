import { ServiceUnavailableException } from '@nestjs/common';
import {
  ContractFunctionRevertedError,
  createPublicClient,
  encodeErrorResult,
  keccak256,
  namehash,
  parseAbi,
  stringToHex,
  toHex,
  zeroAddress,
} from 'viem';
import { sepolia } from 'viem/chains';
import { getEnsAddress, packetToBytes } from 'viem/ens';
import { FileType } from '../common/enums/file-type.enum';
import { EnsV2Contracts, getEnsV2Authorization } from './ens-v2-authorization';

jest.mock('viem/ens', () => ({
  ...jest.requireActual<typeof import('viem/ens')>('viem/ens'),
  getEnsAddress: jest.fn(),
}));

const wallet = '0x0000000000000000000000000000000000000001';
const otherWallet = '0x0000000000000000000000000000000000000002';
const root = '0x0000000000000000000000000000000000000010';
const permissionedResolver = '0x0000000000000000000000000000000000000020';
const contracts: EnsV2Contracts = {
  helper: '0x0000000000000000000000000000000000000030',
  v1Resolver: '0x0000000000000000000000000000000000000040',
  publicResolver: '0x0000000000000000000000000000000000000050',
};

interface ContractRead {
  address: string;
  functionName: string;
  args?: readonly unknown[];
  blockNumber: bigint;
}

function fixture(overrides: Record<string, unknown> = {}) {
  const responses: Record<string, unknown> = {
    ROOT_REGISTRY: root,
    findExactOwner: zeroAddress,
    findResolver: [permissionedResolver, namehash('example.eth'), 0n],
    supportsInterface: true,
    hasRoles: false,
    canModifyName: false,
    ...overrides,
  };
  const readContract = jest.fn(({ functionName }: ContractRead) =>
    Promise.resolve(responses[functionName]),
  );
  const client = {
    chain: sepolia,
    getBlockNumber: jest.fn().mockResolvedValue(123n),
    readContract,
  } as unknown as ReturnType<typeof createPublicClient>;
  return {
    client,
    readContract,
    authorize: (key = FileType.AVATAR) =>
      getEnsV2Authorization(client, contracts, 'example.eth', wallet, key),
  };
}

describe('ENS V2 upload authorization', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(getEnsAddress).mockResolvedValue(null);
  });

  it('accepts the exact owner without requiring any resolver or address record', async () => {
    const { authorize, readContract } = fixture({ findExactOwner: wallet });
    await expect(authorize()).resolves.toBe('allowed');
    expect(
      readContract.mock.calls.some(
        ([call]) => call.functionName === 'findResolver',
      ),
    ).toBe(false);
  });

  it('allows V1 fallback only for an ownerless name routed through the V1 mirror', async () => {
    const mirror = [contracts.v1Resolver, namehash('example.eth'), 0n];
    await expect(fixture({ findResolver: mirror }).authorize()).resolves.toBe(
      'pending',
    );
    await expect(
      fixture({
        findResolver: mirror,
        findExactOwner: otherWallet,
      }).authorize(),
    ).resolves.toBe('denied');
  });

  it.each([
    [wallet, 'allowed'],
    [otherWallet, 'denied'],
    [null, 'pending'],
  ] as const)(
    'uses the V1 address rule at the checked block for %s',
    async (address, expected) => {
      jest.mocked(getEnsAddress).mockResolvedValue(address);
      await expect(
        fixture({
          findResolver: [contracts.v1Resolver, namehash('example.eth'), 0n],
        }).authorize(),
      ).resolves.toBe(expected);
      expect(getEnsAddress).toHaveBeenCalledWith(expect.anything(), {
        name: 'example.eth',
        blockNumber: 123n,
      });
    },
  );

  it('does not authorize a new V2 address when migration happens after the route check', async () => {
    jest
      .mocked(getEnsAddress)
      .mockImplementation((_client, params) =>
        Promise.resolve(params.blockNumber === 123n ? otherWallet : wallet),
      );
    await expect(
      fixture({
        findResolver: [contracts.v1Resolver, namehash('example.eth'), 0n],
      }).authorize(),
    ).resolves.toBe('denied');
  });

  it('queues a name with no owner or resolver but denies a nonowner of an existing resolverless name', async () => {
    const absent = [zeroAddress, namehash('example.eth'), 0n];
    await expect(fixture({ findResolver: absent }).authorize()).resolves.toBe(
      'pending',
    );
    await expect(
      fixture({
        findResolver: absent,
        findExactOwner: otherWallet,
      }).authorize(),
    ).resolves.toBe('denied');
  });

  it.each([FileType.AVATAR, FileType.HEADER])(
    'checks the effective text role for %s, including root grants handled by the resolver',
    async (key) => {
      const { authorize, readContract } = fixture({ hasRoles: true });
      await expect(authorize(key)).resolves.toBe('allowed');
      expect(readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'hasRoles',
          args: [BigInt(keccak256(stringToHex(key))), 16n, wallet],
          blockNumber: 123n,
        }),
      );
      expect(
        readContract.mock.calls.every(([call]) => call.blockNumber === 123n),
      ).toBe(true);
    },
  );

  it('denies a wallet without the relevant editor role', async () => {
    await expect(
      fixture({ findExactOwner: otherWallet }).authorize(),
    ).resolves.toBe('denied');
    expect(getEnsAddress).not.toHaveBeenCalled();
  });

  it('queues an ownerless child with an inherited resolver and no address record', async () => {
    const { authorize } = fixture({
      findResolver: [permissionedResolver, namehash('parent.eth'), 6n],
    });
    await expect(authorize()).resolves.toBe('pending');
    expect(getEnsAddress).toHaveBeenCalledWith(expect.anything(), {
      name: 'example.eth',
      blockNumber: 123n,
      strict: true,
    });
  });

  it('does not authorize an ownerless V2 name through a matching address record', async () => {
    jest.mocked(getEnsAddress).mockResolvedValue(wallet);
    await expect(fixture().authorize()).resolves.toBe('denied');
  });

  it.each([FileType.AVATAR, FileType.HEADER])(
    'stages %s before creation when PublicResolverV2 is inherited',
    async (key) => {
      const { client, authorize, readContract } = fixture({
        findResolver: [contracts.publicResolver, namehash('example.eth'), 8n],
      });
      jest.mocked(client.getBlockNumber).mockResolvedValue(12000000n);
      jest
        .mocked(getEnsAddress)
        .mockImplementation(
          jest.requireActual<typeof import('viem/ens')>('viem/ens')
            .getEnsAddress,
        );
      const errorAbi = parseAbi(['error ResolverNotFound(bytes name)']);
      const resolverNotFound = new ContractFunctionRevertedError({
        abi: errorAbi,
        data: encodeErrorResult({
          abi: errorAbi,
          errorName: 'ResolverNotFound',
          args: [toHex(packetToBytes('example.eth'))],
        }),
        functionName: 'resolveWithGateways',
      });
      const originalRead = readContract.getMockImplementation()!;
      readContract.mockImplementation((call) =>
        call.functionName === 'resolveWithGateways'
          ? Promise.reject(resolverNotFound)
          : originalRead(call),
      );

      await expect(authorize(key)).resolves.toBe('pending');
    },
  );

  it('denies a nonowner when an existing name inherits PublicResolverV2', async () => {
    await expect(
      fixture({
        findExactOwner: otherWallet,
        findResolver: [contracts.publicResolver, namehash('example.eth'), 8n],
      }).authorize(),
    ).resolves.toBe('denied');
  });

  it('propagates an address lookup failure instead of staging an ownerless upload', async () => {
    const failure = new Error('CCIP gateway unavailable');
    jest.mocked(getEnsAddress).mockRejectedValue(failure);
    await expect(fixture().authorize()).rejects.toBe(failure);
  });

  it('checks PublicResolverV2 name permissions for a delegate', async () => {
    const { authorize, readContract } = fixture({
      findResolver: [contracts.publicResolver, namehash('example.eth'), 0n],
      canModifyName: true,
    });
    await expect(authorize()).resolves.toBe('allowed');
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'canModifyName',
        args: [namehash('example.eth'), wallet],
      }),
    );
  });

  it('keeps unsupported resolver authorization distinct from denial or absence', async () => {
    await expect(
      fixture({ supportsInterface: false }).authorize(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('refuses a helper pointing to a different registry', async () => {
    const { authorize, readContract } = fixture();
    readContract.mockImplementation(({ address, functionName }) =>
      Promise.resolve(
        functionName === 'ROOT_REGISTRY' && address === contracts.helper
          ? otherWallet
          : root,
      ),
    );
    await expect(authorize()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('propagates RPC failures instead of allowing fallback or pending cleanup', async () => {
    const { authorize, readContract } = fixture();
    const failure = new Error('RPC unavailable');
    readContract.mockRejectedValue(failure);
    await expect(authorize()).rejects.toBe(failure);
  });
});
