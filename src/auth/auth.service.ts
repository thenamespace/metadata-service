import {
  Inject,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SiweMessage,
  SiweConfig,
  generateNonce,
  isEIP6492Signature,
} from '@signinwithethereum/siwe';
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
  domain?: string;
}

const MAX_PENDING_NONCES_PER_ADDRESS = 3;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private addressToNonces: Map<string, NonceRecord[]> = new Map();

  constructor(
    private readonly configService: ConfigService,
    @Inject(SIWE_CONFIGS) private readonly siweConfigs: SiweConfigsByChain,
  ) {
    this.logger.log('AuthService initialized successfully');
  }

  generateNonce(
    address: string,
    scope?: Scope,
  ): { nonce: string; expiresAt: number } {
    const lower = address.toLowerCase();
    const effectiveScope: Scope = scope ?? 'avatar+header';
    const ttlMs = this.nonceTtlMs();
    let records = this.addressToNonces.get(lower) ?? [];
    records = this.pruneExpired(records);
    const existing = records.find((r) => r.scope === effectiveScope);
    if (existing && Date.now() < existing.expiresAt) {
      return { nonce: existing.nonce, expiresAt: existing.expiresAt };
    }
    records = records.filter((r) => r.scope !== effectiveScope);
    while (records.length >= MAX_PENDING_NONCES_PER_ADDRESS) {
      records = this.evictOldest(records);
    }
    const nonce = generateNonce();
    const issuedAt = Date.now();
    const expiresAt = issuedAt + ttlMs;
    records.push({
      nonce,
      issuedAt,
      expiresAt,
      scope: effectiveScope,
      used: { avatar: false, header: false },
    });
    this.addressToNonces.set(lower, records);
    return { nonce, expiresAt };
  }

  async verifySiweAndConsume(
    params: VerificationParams,
  ): Promise<{ address: string }> {
    const {
      action,
      message,
      signature,
      address,
      domain: providedDomain,
    } = params;
    const lower = address.toLowerCase();
    this.logger.log(
      `siwe.verify.attempt ${JSON.stringify({ address: lower, assertedDomain: providedDomain ?? null })}`,
    );
    let siwe: SiweMessage;
    try {
      siwe = new SiweMessage(message);
    } catch {
      throw new UnauthorizedException({ code: ErrorCodes.MALFORMED_MESSAGE });
    }
    const records = this.addressToNonces.get(lower) ?? [];
    if (records.length === 0) {
      throw new UnauthorizedException({
        code: ErrorCodes.NONCE_NOT_FOUND,
        details: { address },
      });
    }
    const record = records.find((r) => r.nonce === siwe.nonce) ?? null;
    if (!record) {
      this.saveRecords(lower, this.pruneExpired(records));
      throw new UnauthorizedException({
        code: ErrorCodes.NONCE_MISMATCH,
        details: { address },
      });
    }
    const remaining = records.filter((r) => r.nonce !== siwe.nonce);
    if (Date.now() > record.expiresAt) {
      this.saveRecords(lower, this.pruneExpired(remaining));
      throw new UnauthorizedException({ code: ErrorCodes.SIGNATURE_EXPIRED });
    }
    let effectiveDomain: string;
    if (providedDomain) {
      if (siwe.domain !== providedDomain) {
        this.saveRecords(lower, [record, ...remaining]);
        throw new UnauthorizedException({
          code: ErrorCodes.DOMAIN_MISMATCH,
          details: { assertedDomain: providedDomain, siweDomain: siwe.domain },
        });
      }
      effectiveDomain = providedDomain;
    } else if (this.isDomainRequired()) {
      this.saveRecords(lower, [record, ...remaining]);
      throw new UnauthorizedException({ code: ErrorCodes.MISSING_DOMAIN });
    } else {
      this.logger.warn(
        `siwe.domain.deprecated ${JSON.stringify({ address: lower, siweDomain: siwe.domain })}`,
      );
      effectiveDomain = siwe.domain;
    }
    const chainId = Number(siwe.chainId);
    const allowedChainIds = this.getAllowedChainIds();
    if (allowedChainIds.length > 0 && !allowedChainIds.includes(chainId)) {
      this.saveRecords(lower, [record, ...remaining]);
      throw new UnauthorizedException({
        code: ErrorCodes.INVALID_CHAIN_ID,
        details: { chainId },
      });
    }
    const { success, data, error } = await siwe.verify(
      { signature, domain: effectiveDomain, nonce: record.nonce, chainId },
      { config: this.configFor(chainId), suppressExceptions: true },
    );
    if (!success || !data) {
      this.saveRecords(lower, [record, ...remaining]);
      throw new UnauthorizedException({
        code: mapSiweError(error),
        details: { siweErrorType: error?.type },
      });
    }
    if (data.address.toLowerCase() !== lower) {
      this.saveRecords(lower, [record, ...remaining]);
      throw new UnauthorizedException({
        code: ErrorCodes.ADDRESS_MISMATCH,
        details: { recovered: data.address },
      });
    }
    const scope = record.scope;
    if (action === 'avatar') {
      if (scope === 'header' || record.used.avatar) {
        this.saveRecords(lower, [record, ...remaining]);
        throw new ForbiddenException({ code: ErrorCodes.UNAUTHORIZED });
      }
      record.used.avatar = true;
    } else if (action === 'header') {
      if (scope === 'avatar' || record.used.header) {
        this.saveRecords(lower, [record, ...remaining]);
        throw new ForbiddenException({ code: ErrorCodes.UNAUTHORIZED });
      }
      record.used.header = true;
    }
    const fullyConsumed =
      scope === 'avatar+header'
        ? record.used.avatar && record.used.header
        : scope === 'avatar'
          ? record.used.avatar
          : record.used.header;
    if (fullyConsumed || Date.now() > record.expiresAt) {
      this.saveRecords(lower, remaining);
    } else {
      this.saveRecords(lower, [record, ...remaining]);
    }
    const signatureType = isEIP6492Signature(signature)
      ? 'eip6492'
      : 'standard';
    this.logger.log(
      `siwe.verify.success ${JSON.stringify({ address: lower, domain: effectiveDomain, chainId, signatureType })}`,
    );
    return { address: lower };
  }

  private nonceTtlMs(): number {
    return Number(
      this.configService.get<number>('SIWE_NONCE_TTL_MS') || 5 * 60 * 1000,
    );
  }
  private configFor(chainId: number): SiweConfig {
    const config = this.siweConfigs.get(chainId);
    if (config) return config;
    this.logger.warn(
      `No SiweConfig for chainId ${chainId}; falling back to mainnet`,
    );
    const fallback = this.siweConfigs.get(1);
    if (!fallback)
      throw new Error('No SiweConfig available for any supported chain');
    return fallback;
  }
  private isDomainRequired(): boolean {
    return this.configService.get<string>('SIWE_DOMAIN_REQUIRED') === 'true';
  }
  private getAllowedChainIds(): number[] {
    return (
      this.configService.get<string>('SIWE_ALLOWED_CHAIN_IDS') || '1,11155111'
    )
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v));
  }
  private pruneExpired(records: NonceRecord[]): NonceRecord[] {
    const now = Date.now();
    return records.filter((r) => now < r.expiresAt);
  }
  private evictOldest(records: NonceRecord[]): NonceRecord[] {
    if (records.length === 0) return records;
    let oldestIdx = 0;
    for (let i = 1; i < records.length; i++) {
      if (records[i].issuedAt < records[oldestIdx].issuedAt) oldestIdx = i;
    }
    return [...records.slice(0, oldestIdx), ...records.slice(oldestIdx + 1)];
  }
  private saveRecords(lower: string, records: NonceRecord[]): void {
    if (records.length === 0) this.addressToNonces.delete(lower);
    else this.addressToNonces.set(lower, records);
  }
}
