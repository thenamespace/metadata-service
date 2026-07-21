import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { SiweConfig, SiweMessage } from '@signinwithethereum/siwe';
import { getAddress, hashMessage, recoverAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ErrorCodes } from '../common/enums/error-codes.enum';
import { AuthService } from './auth.service';
import { SIWE_CONFIGS } from './siwe.config';

const TEST_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const OTHER_PRIVATE_KEY =
  '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d' as const;
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);
const OTHER_ACCOUNT = privateKeyToAccount(OTHER_PRIVATE_KEY);

function eoaOnlyConfig(): SiweConfig {
  return {
    verifyMessage: async (message: string, signature: string) => {
      const recovered = await recoverAddress({
        hash: hashMessage(message),
        signature: signature as `0x${string}`,
      });

      return getAddress(recovered);
    },
    hashMessage: (message: string) => hashMessage(message),
    getAddress: (address: string) => getAddress(address),
  };
}

function delayedEoaConfig(expectedCalls: number): SiweConfig {
  let calls = 0;
  let release!: () => void;
  const allCallsStarted = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    verifyMessage: async (message: string, signature: string) => {
      calls += 1;
      if (calls === expectedCalls) {
        release();
      }
      await allCallsStarted;

      const recovered = await recoverAddress({
        hash: hashMessage(message),
        signature: signature as `0x${string}`,
      });
      return getAddress(recovered);
    },
    hashMessage: (message: string) => hashMessage(message),
    getAddress: (address: string) => getAddress(address),
  };
}

interface ModuleOptions {
  env?: Record<string, string>;
  configs?: Map<number, SiweConfig>;
}

async function createModule(
  options: ModuleOptions = {},
): Promise<TestingModule> {
  const env: Record<string, string> = {
    SIWE_ALLOWED_CHAIN_IDS: '1,11155111',
    SIWE_NONCE_TTL_MS: '300000',
    ...options.env,
  };
  const configs =
    options.configs ??
    new Map<number, SiweConfig>([
      [1, eoaOnlyConfig()],
      [11155111, eoaOnlyConfig()],
    ]);

  return Test.createTestingModule({
    providers: [
      AuthService,
      {
        provide: ConfigService,
        useValue: { get: (key: string) => env[key] },
      },
      { provide: SIWE_CONFIGS, useValue: configs },
    ],
  }).compile();
}

interface SignedSiweOptions {
  nonce: string;
  address?: string;
  chainId?: number;
  domain?: string;
  expirationTime?: string;
  notBefore?: string;
  privateKey?: `0x${string}`;
  uri?: string;
}

async function signSiweMessage(
  options: SignedSiweOptions,
): Promise<{ message: string; signature: `0x${string}` }> {
  const account = privateKeyToAccount(options.privateKey ?? TEST_PRIVATE_KEY);
  const domain = options.domain ?? 'app.example';
  const message = new SiweMessage({
    domain,
    address: options.address ?? account.address,
    statement: 'Authorize a metadata update',
    uri: options.uri ?? `https://${domain}/profile`,
    version: '1',
    chainId: options.chainId ?? 1,
    nonce: options.nonce,
    issuedAt: new Date().toISOString(),
    expirationTime: options.expirationTime,
    notBefore: options.notBefore,
  }).prepareMessage();
  const signature = await account.signMessage({ message });

  return { message, signature };
}

describe('AuthService', () => {
  let module: TestingModule;
  let service: AuthService;

  beforeEach(async () => {
    module = await createModule();
    service = module.get(AuthService);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await module.close();
  });

  describe('EOA verification', () => {
    it.each(['app.example', 'wallet.partner.example'])(
      'accepts a valid signed message from the integrator domain %s',
      async (domain) => {
        const { nonce } = service.generateNonce(TEST_ACCOUNT.address);
        const signed = await signSiweMessage({ nonce, domain });

        await expect(
          service.verifySiweAndConsume({
            action: 'avatar',
            address: TEST_ACCOUNT.address,
            expectedChainId: 1,
            ...signed,
          }),
        ).resolves.toEqual({ address: TEST_ACCOUNT.address.toLowerCase() });
      },
    );

    it('rejects when the request-body address differs from the verified signed identity', async () => {
      const { nonce } = service.generateNonce(TEST_ACCOUNT.address);
      const signed = await signSiweMessage({
        nonce,
        privateKey: OTHER_PRIVATE_KEY,
        address: OTHER_ACCOUNT.address,
      });

      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          address: TEST_ACCOUNT.address,
          expectedChainId: 1,
          ...signed,
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.ADDRESS_MISMATCH },
      });
    });
  });

  describe('nonce validation', () => {
    it('returns the same live nonce when the same address and scope request it again', () => {
      const first = service.generateNonce(TEST_ACCOUNT.address, 'avatar');
      const second = service.generateNonce(TEST_ACCOUNT.address, 'avatar');

      expect(second).toEqual(first);
    });

    it('keeps different scoped nonces for one address independently verifiable', async () => {
      const avatarNonce = service.generateNonce(TEST_ACCOUNT.address, 'avatar');
      const headerNonce = service.generateNonce(TEST_ACCOUNT.address, 'header');
      const avatarSigned = await signSiweMessage({
        nonce: avatarNonce.nonce,
      });
      const headerSigned = await signSiweMessage({
        nonce: headerNonce.nonce,
      });

      expect(headerNonce.nonce).not.toBe(avatarNonce.nonce);
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          address: TEST_ACCOUNT.address,
          expectedChainId: 1,
          ...avatarSigned,
        }),
      ).resolves.toEqual({ address: TEST_ACCOUNT.address.toLowerCase() });
      await expect(
        service.verifySiweAndConsume({
          action: 'header',
          address: TEST_ACCOUNT.address,
          expectedChainId: 1,
          ...headerSigned,
        }),
      ).resolves.toEqual({ address: TEST_ACCOUNT.address.toLowerCase() });
    });

    it('rejects when no nonce exists for the request-body address', async () => {
      const signed = await signSiweMessage({
        nonce: 'missingNonce12345678',
      });

      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          address: TEST_ACCOUNT.address,
          expectedChainId: 1,
          ...signed,
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.NONCE_NOT_FOUND },
      });
    });

    it('rejects when the signed nonce does not match the stored nonce', async () => {
      service.generateNonce(TEST_ACCOUNT.address);
      const signed = await signSiweMessage({
        nonce: 'differentNonce123456',
      });

      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          address: TEST_ACCOUNT.address,
          expectedChainId: 1,
          ...signed,
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.NONCE_MISMATCH },
      });
    });

    it('rejects a nonce after its server-side TTL expires', async () => {
      const shortLivedModule = await createModule({
        env: { SIWE_NONCE_TTL_MS: '1000' },
      });
      const shortLivedService = shortLivedModule.get(AuthService);
      const issuedAt = Date.now();
      const { nonce } = shortLivedService.generateNonce(TEST_ACCOUNT.address);
      const signed = await signSiweMessage({ nonce });
      jest.spyOn(Date, 'now').mockReturnValue(issuedAt + 1001);

      await expect(
        shortLivedService.verifySiweAndConsume({
          action: 'avatar',
          address: TEST_ACCOUNT.address,
          expectedChainId: 1,
          ...signed,
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.SIGNATURE_EXPIRED },
      });

      await shortLivedModule.close();
    });
  });

  describe('message constraints', () => {
    it('rejects a malformed SIWE message', async () => {
      service.generateNonce(TEST_ACCOUNT.address);

      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          address: TEST_ACCOUNT.address,
          expectedChainId: 1,
          message: 'not a SIWE message',
          signature: `0x${'00'.repeat(65)}`,
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.MALFORMED_MESSAGE },
      });
    });

    it('rejects an expired signed message', async () => {
      const { nonce } = service.generateNonce(TEST_ACCOUNT.address);
      const signed = await signSiweMessage({
        nonce,
        expirationTime: new Date(Date.now() - 60_000).toISOString(),
      });

      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          address: TEST_ACCOUNT.address,
          expectedChainId: 1,
          ...signed,
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.SIGNATURE_EXPIRED },
      });
    });

    it('rejects a signed message before its notBefore time', async () => {
      const { nonce } = service.generateNonce(TEST_ACCOUNT.address);
      const signed = await signSiweMessage({
        nonce,
        notBefore: new Date(Date.now() + 60_000).toISOString(),
      });

      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          address: TEST_ACCOUNT.address,
          expectedChainId: 1,
          ...signed,
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.MESSAGE_NOT_YET_VALID },
      });
    });

    it('rejects a route chain outside the configured allowlist', async () => {
      const sepoliaOnlyModule = await createModule({
        env: { SIWE_ALLOWED_CHAIN_IDS: '11155111' },
      });
      const sepoliaOnlyService = sepoliaOnlyModule.get(AuthService);
      const { nonce } = sepoliaOnlyService.generateNonce(TEST_ACCOUNT.address);
      const signed = await signSiweMessage({ nonce, chainId: 1 });

      await expect(
        sepoliaOnlyService.verifySiweAndConsume({
          action: 'avatar',
          address: TEST_ACCOUNT.address,
          expectedChainId: 1,
          ...signed,
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.INVALID_CHAIN_ID },
      });

      await sepoliaOnlyModule.close();
    });

    it('rejects when the signed message chain differs from the route network', async () => {
      const { nonce } = service.generateNonce(TEST_ACCOUNT.address);
      const signed = await signSiweMessage({
        nonce,
        chainId: 11155111,
      });

      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          address: TEST_ACCOUNT.address,
          expectedChainId: 1,
          ...signed,
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.INVALID_CHAIN_ID },
      });
    });

    it('rejects an allowed chain when no verifier is configured for it', async () => {
      const incompleteModule = await createModule({
        configs: new Map<number, SiweConfig>([[1, eoaOnlyConfig()]]),
      });
      const incompleteService = incompleteModule.get(AuthService);
      const { nonce } = incompleteService.generateNonce(TEST_ACCOUNT.address);
      const signed = await signSiweMessage({
        nonce,
        chainId: 11155111,
      });

      await expect(
        incompleteService.verifySiweAndConsume({
          action: 'avatar',
          address: TEST_ACCOUNT.address,
          expectedChainId: 11155111,
          ...signed,
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.INVALID_CHAIN_ID },
      });

      await incompleteModule.close();
    });
  });

  describe('scope and replay protection', () => {
    it('rejects using an avatar-only nonce for a header action', async () => {
      const { nonce } = service.generateNonce(TEST_ACCOUNT.address, 'avatar');
      const signed = await signSiweMessage({ nonce });

      await expect(
        service.verifySiweAndConsume({
          action: 'header',
          address: TEST_ACCOUNT.address,
          expectedChainId: 1,
          ...signed,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects replaying the same action with an avatar+header nonce', async () => {
      const { nonce } = service.generateNonce(
        TEST_ACCOUNT.address,
        'avatar+header',
      );
      const signed = await signSiweMessage({ nonce });
      const params = {
        action: 'avatar' as const,
        address: TEST_ACCOUNT.address,
        expectedChainId: 1 as const,
        ...signed,
      };

      await expect(service.verifySiweAndConsume(params)).resolves.toEqual({
        address: TEST_ACCOUNT.address.toLowerCase(),
      });
      await expect(service.verifySiweAndConsume(params)).rejects.toMatchObject({
        response: { code: ErrorCodes.UNAUTHORIZED },
      });
    });

    it('allows one avatar and one header action with the same signature, then rejects further replay', async () => {
      const { nonce } = service.generateNonce(
        TEST_ACCOUNT.address,
        'avatar+header',
      );
      const signed = await signSiweMessage({ nonce });

      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          address: TEST_ACCOUNT.address,
          expectedChainId: 1,
          ...signed,
        }),
      ).resolves.toEqual({ address: TEST_ACCOUNT.address.toLowerCase() });
      await expect(
        service.verifySiweAndConsume({
          action: 'header',
          address: TEST_ACCOUNT.address,
          expectedChainId: 1,
          ...signed,
        }),
      ).resolves.toEqual({ address: TEST_ACCOUNT.address.toLowerCase() });
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          address: TEST_ACCOUNT.address,
          expectedChainId: 1,
          ...signed,
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.NONCE_NOT_FOUND },
      });
    });

    it('allows exactly one of two concurrent identical same-action requests', async () => {
      const raceModule = await createModule({
        configs: new Map<number, SiweConfig>([[1, delayedEoaConfig(2)]]),
      });
      const raceService = raceModule.get(AuthService);
      const { nonce } = raceService.generateNonce(
        TEST_ACCOUNT.address,
        'avatar+header',
      );
      const signed = await signSiweMessage({ nonce });
      const params = {
        action: 'avatar' as const,
        address: TEST_ACCOUNT.address,
        expectedChainId: 1 as const,
        ...signed,
      };

      const results = await Promise.allSettled([
        raceService.verifySiweAndConsume(params),
        raceService.verifySiweAndConsume(params),
      ]);
      const fulfilled = results.filter(
        (result): result is PromiseFulfilledResult<{ address: string }> =>
          result.status === 'fulfilled',
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );

      expect(fulfilled).toHaveLength(1);
      expect(fulfilled[0].value).toEqual({
        address: TEST_ACCOUNT.address.toLowerCase(),
      });
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toMatchObject({
        response: { code: ErrorCodes.UNAUTHORIZED },
      });

      await raceModule.close();
    });

    it('allows concurrent avatar and header requests with one combined nonce', async () => {
      const raceModule = await createModule({
        configs: new Map<number, SiweConfig>([[1, delayedEoaConfig(2)]]),
      });
      const raceService = raceModule.get(AuthService);
      const { nonce } = raceService.generateNonce(
        TEST_ACCOUNT.address,
        'avatar+header',
      );
      const signed = await signSiweMessage({ nonce });
      const sharedParams = {
        address: TEST_ACCOUNT.address,
        expectedChainId: 1 as const,
        ...signed,
      };

      const results = await Promise.all([
        raceService.verifySiweAndConsume({
          action: 'avatar',
          ...sharedParams,
        }),
        raceService.verifySiweAndConsume({
          action: 'header',
          ...sharedParams,
        }),
      ]);

      expect(results).toEqual([
        { address: TEST_ACCOUNT.address.toLowerCase() },
        { address: TEST_ACCOUNT.address.toLowerCase() },
      ]);

      await raceModule.close();
    });
  });

  describe('contract-wallet verification', () => {
    it('uses the contract verifier for a short signature without an EOA length heuristic', async () => {
      const contractAddress = getAddress(
        '0x000000000000000000000000000000000000c0de',
      );
      const checkContractWalletSignature = jest.fn((address: string) =>
        Promise.resolve(
          address.toLowerCase() === contractAddress.toLowerCase(),
        ),
      );
      const config: SiweConfig = {
        verifyMessage: () =>
          getAddress('0x000000000000000000000000000000000000dead'),
        hashMessage: (message: string) => hashMessage(message),
        getAddress: (address: string) => getAddress(address),
        checkContractWalletSignature,
      };
      const contractModule = await createModule({
        configs: new Map<number, SiweConfig>([[1, config]]),
      });
      const contractService = contractModule.get(AuthService);
      const { nonce } = contractService.generateNonce(contractAddress);
      const message = new SiweMessage({
        domain: 'contract-wallet.example',
        address: contractAddress,
        statement: 'Authorize a metadata update',
        uri: 'https://contract-wallet.example/profile',
        version: '1',
        chainId: 1,
        nonce,
        issuedAt: new Date().toISOString(),
      }).prepareMessage();

      await expect(
        contractService.verifySiweAndConsume({
          action: 'avatar',
          address: contractAddress,
          expectedChainId: 1,
          message,
          signature: '0xabcd',
        }),
      ).resolves.toEqual({ address: contractAddress.toLowerCase() });
      expect(checkContractWalletSignature).toHaveBeenCalled();

      await contractModule.close();
    });

    it('does not consume a nonce when the contract verifier throws', async () => {
      const contractAddress = getAddress(
        '0x000000000000000000000000000000000000c0de',
      );
      const checkContractWalletSignature = jest
        .fn<Promise<boolean>, [string, string, string, number]>()
        .mockRejectedValueOnce(new Error('RPC unavailable'))
        .mockResolvedValueOnce(true);
      const config: SiweConfig = {
        verifyMessage: () =>
          getAddress('0x000000000000000000000000000000000000dead'),
        hashMessage: (message: string) => hashMessage(message),
        getAddress: (address: string) => getAddress(address),
        checkContractWalletSignature,
      };
      const contractModule = await createModule({
        configs: new Map<number, SiweConfig>([[1, config]]),
      });
      const contractService = contractModule.get(AuthService);
      const { nonce } = contractService.generateNonce(contractAddress);
      const message = new SiweMessage({
        domain: 'contract-wallet.example',
        address: contractAddress,
        statement: 'Authorize a metadata update',
        uri: 'https://contract-wallet.example/profile',
        version: '1',
        chainId: 1,
        nonce,
        issuedAt: new Date().toISOString(),
      }).prepareMessage();
      const params = {
        action: 'avatar' as const,
        address: contractAddress,
        expectedChainId: 1 as const,
        message,
        signature: '0xabcd',
      };

      await expect(
        contractService.verifySiweAndConsume(params),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.SIGNATURE_VERIFICATION_FAILED },
      });
      await expect(
        contractService.verifySiweAndConsume(params),
      ).resolves.toEqual({ address: contractAddress.toLowerCase() });
      expect(checkContractWalletSignature).toHaveBeenCalledTimes(2);

      await contractModule.close();
    });
  });
});
