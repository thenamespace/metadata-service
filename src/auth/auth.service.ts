import { Inject, Injectable, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SiweMessage, SiweConfig, generateNonce, isEIP6492Signature } from '@signinwithethereum/siwe';
import { ErrorCodes } from '../common/enums/error-codes.enum';
import { mapSiweError } from './siwe-error.mapper';
import { SIWE_CONFIGS, SiweConfigsByChain } from './siwe.config';

type Scope = 'avatar' | 'header' | 'avatar+header';
type Action = 'avatar' | 'header';

interface NonceRecord {
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  scope: Scope;
  used: { avatar: boolean; header: boolean };
}

interface VerificationParams {
  action: Action;
  message: string;
  signature: string;
  address: string;
  /** Caller-asserted DNS authority. Optional during grace period; required after. */
  domain?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private addressToNonce: Map<string, NonceRecord> = new Map();

  constructor(
    private readonly configService: ConfigService,
    @Inject(SIWE_CONFIGS) private readonly siweConfigs: SiweConfigsByChain,
  ) {
    this.logger.log('AuthService initialized successfully');
  }

  generateNonce(address: string, scope?: Scope): { nonce: string; expiresAt: number } {
    const nonce = generateNonce();
    const issuedAt = Date.now();
    const ttlMs = Number(this.configService.get<number>('SIWE_NONCE_TTL_MS') || 5 * 60 * 1000);
    const expiresAt = issuedAt + ttlMs;
    const effectiveScope: Scope = scope ?? 'avatar+header';
    this.addressToNonce.set(address.toLowerCase(), {
      nonce,
      issuedAt,
      expiresAt,
      scope: effectiveScope,
      used: { avatar: false, header: false },
    });
    return { nonce, expiresAt };
  }

  private configFor(chainId: number): SiweConfig {
    const config = this.siweConfigs.get(chainId);
    if (config) return config;
    this.logger.warn(`No SiweConfig for chainId ${chainId}; falling back to mainnet`);
    const fallback = this.siweConfigs.get(1);
    if (!fallback) {
      // Startup misconfiguration: factory must seed at least chainId 1.
      throw new Error('No SiweConfig available for any supported chain (expected at least chainId 1)');
    }
    return fallback;
  }

  private isDomainRequired(): boolean {
    return this.configService.get<string>('SIWE_DOMAIN_REQUIRED') === 'true';
  }

  private getAllowedChainIds(): number[] {
    return (this.configService.get<string>('SIWE_ALLOWED_CHAIN_IDS') || '1,11155111')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v));
  }

  async verifySiweAndConsume(params: VerificationParams): Promise<{ address: string }> {
    const { action, message, signature, address, domain: providedDomain } = params;
    const lower = address.toLowerCase();
    this.logger.log(`siwe.verify.attempt ${JSON.stringify({ address: lower, assertedDomain: providedDomain ?? null })}`);

    const record = this.addressToNonce.get(lower);
    if (!record) {
      throw new UnauthorizedException({ code: ErrorCodes.NONCE_NOT_FOUND, details: { address } });
    }

    let siwe: SiweMessage;
    try {
      siwe = new SiweMessage(message);
    } catch {
      throw new UnauthorizedException({ code: ErrorCodes.MALFORMED_MESSAGE });
    }

    // Domain handling (grace-period aware)
    let effectiveDomain: string;
    if (providedDomain) {
      if (siwe.domain !== providedDomain) {
        throw new UnauthorizedException({
          code: ErrorCodes.DOMAIN_MISMATCH,
          details: { assertedDomain: providedDomain, siweDomain: siwe.domain },
        });
      }
      effectiveDomain = providedDomain;
    } else if (this.isDomainRequired()) {
      throw new UnauthorizedException({ code: ErrorCodes.MISSING_DOMAIN });
    } else {
      this.logger.warn(
        `siwe.domain.deprecated ${JSON.stringify({ address: lower, siweDomain: siwe.domain })}`,
      );
      effectiveDomain = siwe.domain; // graceful no-op binding during grace period
    }

    // Chain allowlist
    const chainId = Number(siwe.chainId);
    const allowedChainIds = this.getAllowedChainIds();
    if (allowedChainIds.length > 0 && !allowedChainIds.includes(chainId)) {
      throw new UnauthorizedException({ code: ErrorCodes.INVALID_CHAIN_ID, details: { chainId } });
    }

    // v4 verify
    const { success, data, error } = await siwe.verify(
      { signature, domain: effectiveDomain, nonce: record.nonce, chainId },
      { config: this.configFor(chainId), suppressExceptions: true },
    );
    if (!success || !data) {
      throw new UnauthorizedException({
        code: mapSiweError(error),
        details: { siweErrorType: error?.type },
      });
    }

    // Defence-in-depth address cross-check
    if (data.address.toLowerCase() !== lower) {
      throw new UnauthorizedException({
        code: ErrorCodes.ADDRESS_MISMATCH,
        details: { recovered: data.address },
      });
    }

    // App-specific nonce TTL
    if (Date.now() > record.expiresAt) {
      this.addressToNonce.delete(lower);
      throw new UnauthorizedException({ code: ErrorCodes.SIGNATURE_EXPIRED });
    }

    // Scope + consumption (unchanged from previous behaviour)
    const scope = record.scope;
    if (action === 'avatar') {
      if (scope === 'header' || record.used.avatar) {
        throw new ForbiddenException({ code: ErrorCodes.UNAUTHORIZED });
      }
      record.used.avatar = true;
    } else if (action === 'header') {
      if (scope === 'avatar' || record.used.header) {
        throw new ForbiddenException({ code: ErrorCodes.UNAUTHORIZED });
      }
      record.used.header = true;
    }

    const bothConsumed = record.used.avatar && record.used.header;
    if (bothConsumed || Date.now() > record.expiresAt) {
      this.addressToNonce.delete(lower);
    } else {
      this.addressToNonce.set(lower, record);
    }

    const signatureType = isEIP6492Signature(signature) ? 'eip6492' : 'standard';
    this.logger.log(
      `siwe.verify.success ${JSON.stringify({ address: lower, domain: effectiveDomain, chainId, signatureType })}`,
    );

    return { address: lower };
  }
}
