import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { privateKeyToAccount } from 'viem/accounts';
import { SiweMessage, SiweConfig } from '@signinwithethereum/siwe';
import { keccak256, toBytes, getAddress, recoverAddress, hashMessage } from 'viem';
import { AuthService } from './auth.service';
import { SIWE_CONFIGS, SiweConfigsByChain } from './siwe.config';
import { ErrorCodes } from '../common/enums/error-codes.enum';

/**
 * A tiny EOA-only SiweConfig that uses viem's recoverAddress over a hashed message.
 * Smart-contract paths are exercised by overriding checkContractWalletSignature in
 * specific tests.
 */
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

function buildModule(opts: {
  env?: Record<string, string>;
  configs?: SiweConfigsByChain;
} = {}) {
  const env: Record<string, string> = {
    ALCHEMY_API_KEY: 'test',
    SIWE_ALLOWED_CHAIN_IDS: '1,11155111',
    SIWE_NONCE_TTL_MS: '300000',
    ...(opts.env ?? {}),
  };
  const configs: SiweConfigsByChain =
    opts.configs ?? new Map<number, SiweConfig>([[1, eoaOnlyConfig()], [11155111, eoaOnlyConfig()]]);
  return Test.createTestingModule({
    providers: [
      AuthService,
      { provide: ConfigService, useValue: { get: (key: string) => env[key] } },
      { provide: SIWE_CONFIGS, useValue: configs },
    ],
  }).compile();
}

const TEST_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const TEST_ADDR = privateKeyToAccount(TEST_PK).address;

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
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('siwe.domain.deprecated'));
    });
  });

  describe('post-grace, missing domain', () => {
    it('rejects with MISSING_DOMAIN when SIWE_DOMAIN_REQUIRED=true', async () => {
      const mod = await buildModule({ env: { SIWE_DOMAIN_REQUIRED: 'true' } });
      const svc = mod.get(AuthService);
      const { nonce } = svc.generateNonce(TEST_ADDR);
      const { message, signature } = await signedSiwe({ nonce });
      await expect(
        svc.verifySiweAndConsume({ action: 'avatar', message, signature, address: TEST_ADDR }),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.MISSING_DOMAIN } });
      await mod.close();
    });
  });

  describe('domain mismatch', () => {
    it('rejects with DOMAIN_MISMATCH when caller domain != message domain', async () => {
      const { nonce } = service.generateNonce(TEST_ADDR);
      const { message, signature } = await signedSiwe({ nonce, domain: 'namespace.ninja' });
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message,
          signature,
          address: TEST_ADDR,
          domain: 'evil.com',
        }),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.DOMAIN_MISMATCH } });
    });
  });

  describe('nonce branches', () => {
    it('rejects with NONCE_NOT_FOUND when no nonce was generated', async () => {
      const { message, signature } = await signedSiwe({ nonce: 'abcdefghij1234567890' });
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message,
          signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.NONCE_NOT_FOUND } });
    });

    it('rejects with NONCE_MISMATCH when message nonce differs from stored', async () => {
      service.generateNonce(TEST_ADDR);
      const { message, signature } = await signedSiwe({ nonce: 'WRONGnonce1234567890abc' });
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message,
          signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.NONCE_MISMATCH } });
    });
  });

  describe('time branches', () => {
    it('rejects with SIGNATURE_EXPIRED when expirationTime is in the past', async () => {
      const { nonce } = service.generateNonce(TEST_ADDR);
      const past = new Date(Date.now() - 60_000).toISOString();
      const { message, signature } = await signedSiwe({ nonce, expirationTime: past });
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message,
          signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.SIGNATURE_EXPIRED } });
    });

    it('rejects with MESSAGE_NOT_YET_VALID when notBefore is in the future', async () => {
      const { nonce } = service.generateNonce(TEST_ADDR);
      const future = new Date(Date.now() + 60_000).toISOString();
      const { message, signature } = await signedSiwe({ nonce, notBefore: future });
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message,
          signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.MESSAGE_NOT_YET_VALID } });
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
      ).rejects.toMatchObject({ response: { code: ErrorCodes.SIGNATURE_EXPIRED } });
      await mod.close();
    });
  });

  describe('chain branches', () => {
    it('rejects with INVALID_CHAIN_ID when chainId not in SIWE_ALLOWED_CHAIN_IDS', async () => {
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
      ).rejects.toMatchObject({ response: { code: ErrorCodes.INVALID_CHAIN_ID } });
      await mod.close();
    });
  });

  describe('address mismatch', () => {
    it('rejects with ADDRESS_MISMATCH when body.address != recovered signer', async () => {
      const otherPk = '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d';
      const otherAddr = privateKeyToAccount(otherPk).address;
      const { nonce } = service.generateNonce(otherAddr);
      // Sign a message AS otherPk but claim TEST_ADDR in the request body.
      const { message, signature } = await signedSiwe({
        nonce,
        privateKey: otherPk as `0x${string}`,
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
    it('rejects with MALFORMED_MESSAGE when the message is unparseable', async () => {
      service.generateNonce(TEST_ADDR);
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message: 'this is not a SIWE message at all',
          signature: '0x' + '00'.repeat(65),
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.MALFORMED_MESSAGE } });
    });
  });

  describe('scope + consumption', () => {
    it('rejects using an avatar-only nonce for a header action', async () => {
      service.generateNonce(TEST_ADDR, 'avatar');
      const { nonce } = service.generateNonce(TEST_ADDR, 'avatar'); // returns same logic; refetch
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

    it('allows avatar+header dual consumption with one nonce, rejects a third use', async () => {
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

      // Same nonce, different action.
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

      // Third call: record should be deleted by now.
      const third = await signedSiwe({ nonce });
      await expect(
        service.verifySiweAndConsume({
          action: 'avatar',
          message: third.message,
          signature: third.signature,
          address: TEST_ADDR,
          domain: 'namespace.ninja',
        }),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.NONCE_NOT_FOUND } });
    });

    it('rejects a replay of the same action against an avatar+header nonce', async () => {
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
    it('verifies via checkContractWalletSignature when EOA recovery does not match', async () => {
      // A contract wallet "owns" SAFE_ADDR but the underlying signer is TEST_ADDR.
      // To force the contract path, we use a config whose verifyMessage returns
      // a non-matching address and whose checkContractWalletSignature returns true.
      const SAFE_ADDR = '0x000000000000000000000000000000000000c0DE';
      const config: SiweConfig = {
        verifyMessage: async () => getAddress('0x000000000000000000000000000000000000dEaD'),
        hashMessage: (m) => hashMessage(m),
        getAddress: (a) => getAddress(a),
        checkContractWalletSignature: async (address, _msg, _sig, _chainId) =>
          address.toLowerCase() === SAFE_ADDR.toLowerCase(),
      };
      const mod = await buildModule({
        configs: new Map<number, SiweConfig>([[1, config], [11155111, config]]),
      });
      const svc = mod.get(AuthService);
      const { nonce } = svc.generateNonce(SAFE_ADDR, 'avatar+header');
      // The message must claim SAFE_ADDR; the (fake) signature can be anything 130+ hex.
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
});
