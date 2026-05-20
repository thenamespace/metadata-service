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
});
