import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { privateKeyToAccount } from 'viem/accounts';
import { SiweMessage, SiweConfig } from '@signinwithethereum/siwe';
import { getAddress, recoverAddress, hashMessage } from 'viem';
import { AuthService } from './auth.service';
import { SIWE_CONFIGS, SiweConfigsByChain } from './siwe.config';
import { ErrorCodes } from '../common/enums/error-codes.enum';

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

function buildModule(
  opts: { env?: Record<string, string>; configs?: SiweConfigsByChain } = {},
) {
  const env: Record<string, string> = {
    ALCHEMY_API_KEY: 'test',
    SIWE_ALLOWED_CHAIN_IDS: '1,11155111',
    SIWE_NONCE_TTL_MS: '300000',
    ...(opts.env ?? {}),
  };
  const configs =
    opts.configs ??
    new Map<number, SiweConfig>([
      [1, eoaOnlyConfig()],
      [11155111, eoaOnlyConfig()],
    ]);
  return Test.createTestingModule({
    providers: [
      AuthService,
      { provide: ConfigService, useValue: { get: (key: string) => env[key] } },
      { provide: SIWE_CONFIGS, useValue: configs },
    ],
  }).compile();
}

const TEST_PK =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const TEST_ADDR = privateKeyToAccount(TEST_PK).address;
const TEST_PK2 =
  '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d';
const TEST_ADDR2 = privateKeyToAccount(TEST_PK2).address;

async function signedSiwe(opts: {
  address?: string;
  domain?: string;
  nonce: string;
  chainId?: number;
  uri?: string;
  expirationTime?: string;
  notBefore?: string;
  privateKey?: `0x${string}`;
}): Promise<{ message: string; signature: string }> {
  const account = privateKeyToAccount(opts.privateKey ?? TEST_PK);
  const msg = new SiweMessage({
    domain: opts.domain ?? 'namespace.ninja',
    address: opts.address ?? account.address,
    statement: 'Sign in to Avatar Service',
    uri: opts.uri ?? 'https://namespace.ninja',
    version: '1',
    chainId: opts.chainId ?? 1,
    nonce: opts.nonce,
    issuedAt: new Date().toISOString(),
    expirationTime: opts.expirationTime,
    notBefore: opts.notBefore,
  }).prepareMessage();
  const signature = await account.signMessage({ message: msg });
  return { message: msg, signature };
}

describe('AuthService', () => {
  let service: AuthService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await buildModule();
    service = module.get(AuthService);
  });
  afterEach(async () => {
    await module.close();
    jest.restoreAllMocks();
  });

  describe('EOA happy path with domain', () => {
    it('verifies and returns the lowercase address', async () => {
      const { nonce } = service.generateNonce(TEST_ADDR);
      const { message, signature } = await signedSiwe({ nonce });
      const result = await service.verifySiweAndConsume({
        action: 'avatar',
        message,
        signature,
        address: TEST_ADDR,
        domain: 'namespace.ninja',
      });
      expect(result).toEqual({ address: TEST_ADDR.toLowerCase() });
    });
  });

  describe('EOA happy path during grace (no domain)', () => {
    it('verifies, falls back to message-derived domain, returns address', async () => {
      const { nonce } = service.generateNonce(TEST_ADDR);
      const { message, signature } = await signedSiwe({ nonce });
      const warn = jest.spyOn((service as any).logger, 'warn');
      const result = await service.verifySiweAndConsume({
        action: 'avatar',
        message,
        signature,
        address: TEST_ADDR,
      });
      expect(result.address).toBe(TEST_ADDR.toLowerCase());
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('siwe.domain.deprecated'),
      );
    });
  });

  describe('post-grace, missing domain', () => {
    it('rejects with MISSING_DOMAIN when SIWE_DOMAIN_REQUIRED=true', async () => {
      const mod = await buildModule({ env: { SIWE_DOMAIN_REQUIRED: 'true' } });
      const svc = mod.get(AuthService);
      const { nonce } = svc.generateNonce(TEST_ADDR);
      const { message, signature } = await signedSiwe({ nonce });
      await expect(
        svc.verifySiweAndConsume({
          action: 'avatar',
          message,
          signature,
          address: TEST_ADDR,
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.MISSING_DOMAIN },
      });
      await mod.close();
    });
  });

  describe('domain mismatch', () => {
    it('rejects with DOMAIN_MISMATCH when caller domain != message domain', async () => {
      const { nonce } = service.generateNonce(TEST_ADDR);
      const { message, signature } = await signedSiwe({
        nonce,
        domain: 'namespace.ninja',
      });
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message,
          signature,
          address: TEST_ADDR,
          domain: 'evil.com',
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.DOMAIN_MISMATCH },
      });
    });
  });

  describe('nonce branches', () => {
    it('draws independent entropy for distinct addresses', () => {
      const entropyBytes = [0, 255];
      const getRandomValues = jest
        .spyOn(globalThis.crypto, 'getRandomValues')
        .mockImplementation((array) => {
          const bytes = new Uint8Array(
            array.buffer,
            array.byteOffset,
            array.byteLength,
          );
          bytes.fill(entropyBytes.shift() as number);
          return array;
        });
      const first = service.generateNonce(TEST_ADDR).nonce;
      const second = service.generateNonce(TEST_ADDR2).nonce;
      expect(getRandomValues).toHaveBeenCalledTimes(2);
      expect(first).toMatch(/^[A-Za-z0-9]{17}$/);
      expect(second).toMatch(/^[A-Za-z0-9]{17}$/);
      expect(first).not.toBe(second);
      expect(second.slice(0, -1)).not.toBe(first.slice(1));
    });

    it('rejects with NONCE_NOT_FOUND when no nonce for address', async () => {
      const { message, signature } = await signedSiwe({
        nonce: 'abcdefghij1234567890',
      });
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message,
          signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.NONCE_NOT_FOUND },
      });
    });

    it('rejects with NONCE_MISMATCH when address has records but nonce absent', async () => {
      service.generateNonce(TEST_ADDR);
      const { message, signature } = await signedSiwe({
        nonce: 'WRONGnonce1234567890abc',
      });
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message,
          signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.NONCE_MISMATCH },
      });
    });
  });

  describe('time branches', () => {
    it('rejects with SIGNATURE_EXPIRED when expirationTime past', async () => {
      const { nonce } = service.generateNonce(TEST_ADDR);
      const past = new Date(Date.now() - 60_000).toISOString();
      const { message, signature } = await signedSiwe({
        nonce,
        expirationTime: past,
      });
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message,
          signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.SIGNATURE_EXPIRED },
      });
    });

    it('rejects with MESSAGE_NOT_YET_VALID when notBefore future', async () => {
      const { nonce } = service.generateNonce(TEST_ADDR);
      const future = new Date(Date.now() + 60_000).toISOString();
      const { message, signature } = await signedSiwe({
        nonce,
        notBefore: future,
      });
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message,
          signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.MESSAGE_NOT_YET_VALID },
      });
    });

    it('rejects with SIGNATURE_EXPIRED when nonce-store TTL has passed', async () => {
      const mod = await buildModule({ env: { SIWE_NONCE_TTL_MS: '1' } });
      const svc = mod.get(AuthService);
      const { nonce } = svc.generateNonce(TEST_ADDR);
      await new Promise((r) => setTimeout(r, 10));
      const { message, signature } = await signedSiwe({ nonce });
      await expect(
        svc.verifySiweAndConsume({
          action: 'avatar',
          message,
          signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.SIGNATURE_EXPIRED },
      });
      await mod.close();
    });
  });

  describe('chain branches', () => {
    it('rejects with INVALID_CHAIN_ID when chainId not allowed', async () => {
      const mod = await buildModule({ env: { SIWE_ALLOWED_CHAIN_IDS: '1' } });
      const svc = mod.get(AuthService);
      const { nonce } = svc.generateNonce(TEST_ADDR);
      const { message, signature } = await signedSiwe({ nonce, chainId: 137 });
      await expect(
        svc.verifySiweAndConsume({
          action: 'avatar',
          message,
          signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.INVALID_CHAIN_ID },
      });
      await mod.close();
    });
  });

  describe('address mismatch', () => {
    it('rejects with ADDRESS_MISMATCH when body.address != recovered signer', async () => {
      const otherAddr = TEST_ADDR2;
      const { nonce } = service.generateNonce(otherAddr);
      const { message, signature } = await signedSiwe({
        nonce,
        privateKey: TEST_PK2,
        address: otherAddr,
      });
      service.generateNonce(TEST_ADDR);
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message,
          signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('malformed message', () => {
    it('rejects with MALFORMED_MESSAGE when message unparseable', async () => {
      service.generateNonce(TEST_ADDR);
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message: 'this is not a SIWE message at all',
          signature: '0x' + '00'.repeat(65),
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.MALFORMED_MESSAGE },
      });
    });
  });

  describe('scope + consumption', () => {
    it('rejects using an avatar-only nonce for a header action', async () => {
      const { nonce } = service.generateNonce(TEST_ADDR, 'avatar');
      const { message, signature } = await signedSiwe({ nonce });
      await expect(
        service.verifySiweAndConsume({
          action: 'header',
          message,
          signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows avatar+header dual consumption, rejects third use', async () => {
      const { nonce } = service.generateNonce(TEST_ADDR, 'avatar+header');
      const first = await signedSiwe({ nonce });
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message: first.message,
          signature: first.signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).resolves.toEqual({ address: TEST_ADDR.toLowerCase() });
      const second = await signedSiwe({ nonce });
      await expect(
        service.verifySiweAndConsume({
          action: 'header',
          message: second.message,
          signature: second.signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).resolves.toEqual({ address: TEST_ADDR.toLowerCase() });
      const third = await signedSiwe({ nonce });
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message: third.message,
          signature: third.signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.NONCE_NOT_FOUND },
      });
    });

    it('rejects replay of same action against avatar+header nonce', async () => {
      const { nonce } = service.generateNonce(TEST_ADDR, 'avatar+header');
      const sample = await signedSiwe({ nonce });
      await service.verifySiweAndConsume({
        action: 'avatar',
        message: sample.message,
        signature: sample.signature,
        address: TEST_ADDR,
        domain: 'namespace.ninja',
      });
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message: sample.message,
          signature: sample.signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('EIP-1271 smart contract wallet', () => {
    it('verifies via checkContractWalletSignature when EOA recovery mismatches', async () => {
      const SAFE_ADDR = '0x000000000000000000000000000000000000c0DE';
      const config: SiweConfig = {
        verifyMessage: () =>
          Promise.resolve(
            getAddress('0x000000000000000000000000000000000000dEaD'),
          ),
        hashMessage: (m) => hashMessage(m),
        getAddress: (a) => getAddress(a),
        checkContractWalletSignature: (address: string) =>
          Promise.resolve(address.toLowerCase() === SAFE_ADDR.toLowerCase()),
      };
      const mod = await buildModule({
        configs: new Map<number, SiweConfig>([
          [1, config],
          [11155111, config],
        ]),
      });
      const svc = mod.get(AuthService);
      const { nonce } = svc.generateNonce(SAFE_ADDR, 'avatar+header');
      const message = new SiweMessage({
        domain: 'namespace.ninja',
        address: SAFE_ADDR,
        statement: 'Sign in to Avatar Service',
        uri: 'https://namespace.ninja',
        version: '1',
        chainId: 1,
        nonce,
        issuedAt: new Date().toISOString(),
      }).prepareMessage();
      const signature = '0x' + 'ab'.repeat(70);
      const result = await svc.verifySiweAndConsume({
        action: 'avatar',
        message,
        signature,
        address: SAFE_ADDR,
        domain: 'namespace.ninja',
      });
      expect(result.address).toBe(SAFE_ADDR.toLowerCase());
      await mod.close();
    });
  });

  // ===== MULTI-PENDING-NONCE TESTS =====

  describe('multi-pending-nonce: idempotency', () => {
    it('(1) same address + same scope returns same nonce (idempotent)', () => {
      const first = service.generateNonce(TEST_ADDR, 'avatar');
      const second = service.generateNonce(TEST_ADDR, 'avatar');
      expect(second.nonce).toBe(first.nonce);
      expect(second.expiresAt).toBe(first.expiresAt);
    });
    it('same address + different scope returns distinct nonce', () => {
      const a = service.generateNonce(TEST_ADDR, 'avatar');
      const h = service.generateNonce(TEST_ADDR, 'header');
      expect(h.nonce).not.toBe(a.nonce);
    });
  });

  describe('multi-pending-nonce: non-invalidation', () => {
    it('(2) different scope does not invalidate original signed nonce', async () => {
      const avatarNonce = service.generateNonce(TEST_ADDR, 'avatar');
      const headerNonce = service.generateNonce(TEST_ADDR, 'header');
      expect(headerNonce.nonce).not.toBe(avatarNonce.nonce);
      const { message, signature } = await signedSiwe({
        nonce: avatarNonce.nonce,
      });
      const result = await service.verifySiweAndConsume({
        action: 'avatar',
        message,
        signature,
        address: TEST_ADDR,
        domain: 'namespace.ninja',
      });
      expect(result).toEqual({ address: TEST_ADDR.toLowerCase() });
    });
  });

  describe('multi-pending-nonce: scope enforcement', () => {
    it('(3) each scope nonce enforces its own scope', async () => {
      const avatarNonce = service.generateNonce(TEST_ADDR, 'avatar');
      const headerNonce = service.generateNonce(TEST_ADDR, 'header');
      const hMsg = await signedSiwe({ nonce: headerNonce.nonce });
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message: hMsg.message,
          signature: hMsg.signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      const aMsg = await signedSiwe({ nonce: avatarNonce.nonce });
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message: aMsg.message,
          signature: aMsg.signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).resolves.toEqual({ address: TEST_ADDR.toLowerCase() });
    });
  });

  describe('multi-pending-nonce: independent consumption', () => {
    it('(4) consuming one nonce leaves other pending nonces usable', async () => {
      const aN = service.generateNonce(TEST_ADDR, 'avatar');
      const hN = service.generateNonce(TEST_ADDR, 'header');
      const aMsg = await signedSiwe({ nonce: aN.nonce });
      await service.verifySiweAndConsume({
        action: 'avatar',
        message: aMsg.message,
        signature: aMsg.signature,
        address: TEST_ADDR,
        domain: 'namespace.ninja',
      });
      const hMsg = await signedSiwe({ nonce: hN.nonce });
      await expect(
        service.verifySiweAndConsume({
          action: 'header',
          message: hMsg.message,
          signature: hMsg.signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).resolves.toEqual({ address: TEST_ADDR.toLowerCase() });
    });
    it('after consuming both scopes, address has no records', async () => {
      const aN = service.generateNonce(TEST_ADDR, 'avatar');
      const hN = service.generateNonce(TEST_ADDR, 'header');
      const aMsg = await signedSiwe({ nonce: aN.nonce });
      await service.verifySiweAndConsume({
        action: 'avatar',
        message: aMsg.message,
        signature: aMsg.signature,
        address: TEST_ADDR,
        domain: 'namespace.ninja',
      });
      const hMsg = await signedSiwe({ nonce: hN.nonce });
      await service.verifySiweAndConsume({
        action: 'header',
        message: hMsg.message,
        signature: hMsg.signature,
        address: TEST_ADDR,
        domain: 'namespace.ninja',
      });
      const { message, signature } = await signedSiwe({ nonce: aN.nonce });
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message,
          signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.NONCE_NOT_FOUND },
      });
    });
  });

  describe('multi-pending-nonce: expiry pruning', () => {
    it('(5) expired records pruned; fresh nonce for same scope', async () => {
      const mod = await buildModule({ env: { SIWE_NONCE_TTL_MS: '1' } });
      const svc = mod.get(AuthService);
      const old = svc.generateNonce(TEST_ADDR, 'avatar');
      await new Promise((r) => setTimeout(r, 10));
      const fresh = svc.generateNonce(TEST_ADDR, 'avatar');
      expect(fresh.nonce).not.toBe(old.nonce);
      await mod.close();
    });
    it('pruning expired does not affect unexpired for other scopes', async () => {
      const mod = await buildModule({ env: { SIWE_NONCE_TTL_MS: '50' } });
      const svc = mod.get(AuthService);
      const hN = svc.generateNonce(TEST_ADDR, 'header');
      await new Promise((r) => setTimeout(r, 10));
      svc.generateNonce(TEST_ADDR, 'avatar');
      const hMsg = await signedSiwe({ nonce: hN.nonce });
      await expect(
        svc.verifySiweAndConsume({
          action: 'header',
          message: hMsg.message,
          signature: hMsg.signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).resolves.toEqual({ address: TEST_ADDR.toLowerCase() });
      await mod.close();
    });
  });

  describe('multi-pending-nonce: storage cap', () => {
    it('(6) at cap, idempotent return for existing scopes (no leak)', () => {
      const f1 = service.generateNonce(TEST_ADDR, 'avatar');
      const f2 = service.generateNonce(TEST_ADDR, 'header');
      const f3 = service.generateNonce(TEST_ADDR, 'avatar+header');
      expect(f1.nonce).not.toBe(f2.nonce);
      expect(f2.nonce).not.toBe(f3.nonce);
      expect(f1.nonce).not.toBe(f3.nonce);
      const again = service.generateNonce(TEST_ADDR, 'avatar');
      expect(again.nonce).toBe(f1.nonce);
    });
  });

  describe('multi-pending-nonce: NONCE_NOT_FOUND vs NONCE_MISMATCH', () => {
    it('NONCE_NOT_FOUND when address has zero pending records', async () => {
      const { message, signature } = await signedSiwe({
        nonce: 'any1234567890abc',
      });
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message,
          signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.NONCE_NOT_FOUND },
      });
    });
    it('NONCE_MISMATCH when address has records but nonce absent', async () => {
      service.generateNonce(TEST_ADDR, 'avatar');
      const { message, signature } = await signedSiwe({
        nonce: 'noSuch9876543210',
      });
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message,
          signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.NONCE_MISMATCH },
      });
    });
  });

  describe('multi-pending-nonce: avatar+header dual consumption', () => {
    it('avatar+header scope allows both actions, then NONCE_NOT_FOUND', async () => {
      const { nonce } = service.generateNonce(TEST_ADDR, 'avatar+header');
      const aMsg = await signedSiwe({ nonce });
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message: aMsg.message,
          signature: aMsg.signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).resolves.toEqual({ address: TEST_ADDR.toLowerCase() });
      const hMsg = await signedSiwe({ nonce });
      await expect(
        service.verifySiweAndConsume({
          action: 'header',
          message: hMsg.message,
          signature: hMsg.signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).resolves.toEqual({ address: TEST_ADDR.toLowerCase() });
      const third = await signedSiwe({ nonce });
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message: third.message,
          signature: third.signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.NONCE_NOT_FOUND },
      });
    });
  });
});
