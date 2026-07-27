import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateNonce,
  SiweError,
  SiweErrorType,
  SiweMessage,
  SiweResponse,
} from '@signinwithethereum/siwe';
import { ErrorCodes } from '../common/enums/error-codes.enum';
import { SIWE_CONFIGS, SiweConfigMap } from './siwe.config';
import { AvatarObservabilityService } from '../observability/avatar-observability.service';
import { FileType } from '../common/enums/file-type.enum';
import { Network } from '../common/enums/network.enum';

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
  address?: string;
  expectedChainId: 1 | 11155111;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly addressToNonces = new Map<string, Map<Scope, NonceRecord>>();

  constructor(
    private readonly configService: ConfigService,
    @Inject(SIWE_CONFIGS) private readonly siweConfigs: SiweConfigMap,
    @Optional()
    private readonly observability?: AvatarObservabilityService,
  ) {
    this.logger.log('AuthService initialized successfully');
  }

  generateNonce(
    address: string,
    scope?: Scope,
  ): { nonce: string; expiresAt: number } {
    const normalizedAddress = address.toLowerCase();
    const effectiveScope: Scope = scope ?? 'avatar+header';
    const issuedAt = Date.now();
    const records =
      this.addressToNonces.get(normalizedAddress) ??
      new Map<Scope, NonceRecord>();
    this.pruneExpiredRecords(normalizedAddress, records, issuedAt);

    const existing = records.get(effectiveScope);
    if (existing) {
      return { nonce: existing.nonce, expiresAt: existing.expiresAt };
    }

    const nonce = generateNonce();
    const configuredTtl = Number(
      this.configService.get<number>('SIWE_NONCE_TTL_MS'),
    );
    const ttlMs =
      Number.isFinite(configuredTtl) && configuredTtl > 0
        ? configuredTtl
        : 5 * 60 * 1000;
    const expiresAt = issuedAt + ttlMs;

    records.set(effectiveScope, {
      nonce,
      issuedAt,
      expiresAt,
      scope: effectiveScope,
      used: { avatar: false, header: false },
    });
    this.addressToNonces.set(normalizedAddress, records);

    return { nonce, expiresAt };
  }

  async verifySiweAndConsume(
    params: VerificationParams,
  ): Promise<{ address: string; signedDomain: string }> {
    const { action, expectedChainId } = params;
    const startedAt = process.hrtime.bigint();
    const network = expectedChainId === 1 ? Network.MAINNET : Network.SEPOLIA;
    try {
      const result = await this.verifySiwe(params);
      this.observability?.recordSiwe(
        action === 'avatar' ? FileType.AVATAR : FileType.HEADER,
        network,
        'success',
        Number(process.hrtime.bigint() - startedAt) / 1e9,
      );
      return result;
    } catch (error) {
      this.observability?.recordSiwe(
        action === 'avatar' ? FileType.AVATAR : FileType.HEADER,
        network,
        this.observability?.siweResult(error) ?? 'unknown_error',
        Number(process.hrtime.bigint() - startedAt) / 1e9,
      );
      throw error;
    }
  }

  private async verifySiwe(
    params: VerificationParams,
  ): Promise<{ address: string; signedDomain: string }> {
    const { action, message, signature, address, expectedChainId } = params;
    const siwe = this.parseMessage(message);
    const signedAddress = siwe.address.toLowerCase();

    this.logger.log(
      `Starting signature verification for signed address: ${signedAddress}, action: ${action}`,
    );

    // The body address is retained only for backwards compatibility. Identity
    // and nonce selection both come from the signed SIWE payload.
    if (address && address.toLowerCase() !== signedAddress) {
      throw new UnauthorizedException({
        code: ErrorCodes.ADDRESS_MISMATCH,
        details: {
          message: 'Address in signature does not match provided address',
        },
      });
    }

    const records = this.addressToNonces.get(signedAddress);
    if (!records) {
      throw new UnauthorizedException({
        code: ErrorCodes.NONCE_NOT_FOUND,
        details: { address: signedAddress },
      });
    }

    const record = [...records.values()].find(
      (candidate) => candidate.nonce === siwe.nonce,
    );
    if (!record) {
      this.pruneExpiredRecords(signedAddress, records, Date.now());
      throw new UnauthorizedException({
        code: ErrorCodes.NONCE_MISMATCH,
        details: {
          message: 'Nonce in signature does not match any issued nonce',
        },
      });
    }

    if (Date.now() > record.expiresAt) {
      this.deleteRecord(signedAddress, records, record.scope);
      throw new UnauthorizedException({
        code: ErrorCodes.SIGNATURE_EXPIRED,
        details: { message: 'Nonce has expired' },
      });
    }

    if (siwe.chainId !== expectedChainId) {
      throw new UnauthorizedException({
        code: ErrorCodes.INVALID_CHAIN_ID,
        details: {
          message: 'SIWE chain ID does not match the requested network',
          expected: expectedChainId,
          received: siwe.chainId,
        },
      });
    }

    this.assertAllowedChainId(siwe.chainId);
    const siweConfig = this.siweConfigs.get(siwe.chainId);
    if (!siweConfig) {
      throw new UnauthorizedException({
        code: ErrorCodes.INVALID_CHAIN_ID,
        details: {
          message: 'No SIWE verification client is configured for this chain',
          chainId: siwe.chainId,
        },
      });
    }

    let verification: SiweResponse;
    try {
      verification = await siwe.verify(
        {
          signature,
          nonce: record.nonce,
          // This is intentionally derived from the signed message. The service
          // is open to any integrator domain, so this checks message consistency
          // but does not provide origin binding to a server-controlled allowlist.
          domain: siwe.domain,
          chainId: expectedChainId,
        },
        { config: siweConfig, suppressExceptions: true },
      );
    } catch {
      this.logger.error('Unexpected SIWE verification failure');
      throw new UnauthorizedException({
        code: ErrorCodes.SIGNATURE_VERIFICATION_FAILED,
        details: { message: 'Signature verification failed' },
      });
    }

    if (!verification.success) {
      this.throwVerificationError(verification.error);
    }

    const verifiedAddress = verification.data.address.toLowerCase();
    if (address && address.toLowerCase() !== verifiedAddress) {
      throw new UnauthorizedException({
        code: ErrorCodes.ADDRESS_MISMATCH,
        details: {
          message: 'Verified address does not match provided address',
        },
      });
    }

    this.consumeScope(record, action, signedAddress);
    this.logger.log(
      `Signature verification successful for address: ${verifiedAddress}`,
    );

    return { address: verifiedAddress, signedDomain: siwe.domain };
  }

  private parseMessage(message: string): SiweMessage {
    try {
      return new SiweMessage(message);
    } catch {
      this.logger.warn('Unable to parse SIWE message');
      throw new UnauthorizedException({
        code: ErrorCodes.MALFORMED_MESSAGE,
        details: { message: 'Unable to parse SIWE message' },
      });
    }
  }

  private assertAllowedChainId(chainId: number): void {
    const configured =
      this.configService.get<string>('SIWE_ALLOWED_CHAIN_IDS') ?? '1,11155111';
    const allowedChainIds = configured
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0);

    if (!allowedChainIds.includes(chainId)) {
      throw new UnauthorizedException({
        code: ErrorCodes.INVALID_CHAIN_ID,
        details: { message: 'Chain ID not allowed', chainId },
      });
    }
  }

  private throwVerificationError(error?: SiweError): never {
    const type = error?.type;
    let code: ErrorCodes;

    switch (type) {
      case SiweErrorType.NONCE_MISMATCH:
        code = ErrorCodes.NONCE_MISMATCH;
        break;
      case SiweErrorType.EXPIRED_MESSAGE:
        code = ErrorCodes.SIGNATURE_EXPIRED;
        break;
      case SiweErrorType.NOT_YET_VALID_MESSAGE:
        code = ErrorCodes.MESSAGE_NOT_YET_VALID;
        break;
      case SiweErrorType.INVALID_ADDRESS:
        code = ErrorCodes.INVALID_ADDRESS;
        break;
      case SiweErrorType.CHAIN_ID_MISMATCH:
      case SiweErrorType.INVALID_SIGNATURE_CHAIN_ID:
        code = ErrorCodes.INVALID_CHAIN_ID;
        break;
      case SiweErrorType.UNABLE_TO_PARSE:
      case SiweErrorType.MALFORMED_MESSAGE:
      case SiweErrorType.INVALID_DOMAIN:
      case SiweErrorType.INVALID_URI:
      case SiweErrorType.INVALID_NONCE:
      case SiweErrorType.INVALID_MESSAGE_VERSION:
      case SiweErrorType.INVALID_TIME_FORMAT:
        code = ErrorCodes.MALFORMED_MESSAGE;
        break;
      default:
        code = ErrorCodes.SIGNATURE_VERIFICATION_FAILED;
    }

    throw new UnauthorizedException({
      code,
      details: {
        message: error?.message ?? 'Signature verification failed',
      },
    });
  }

  private consumeScope(
    record: NonceRecord,
    action: Action,
    address: string,
  ): void {
    // This compare-and-consume section is deliberately synchronous. A second
    // request may have completed while v4 awaited an RPC response, so operate
    // only on the exact record that was verified and is still current.
    const records = this.addressToNonces.get(address);
    const current = records?.get(record.scope);
    if (!records || !current) {
      throw new UnauthorizedException({ code: ErrorCodes.NONCE_NOT_FOUND });
    }
    if (current !== record || current.nonce !== record.nonce) {
      throw new UnauthorizedException({ code: ErrorCodes.NONCE_MISMATCH });
    }
    if (Date.now() > current.expiresAt) {
      this.deleteRecord(address, records, current.scope);
      throw new UnauthorizedException({
        code: ErrorCodes.SIGNATURE_EXPIRED,
        details: { message: 'Nonce has expired' },
      });
    }

    if (action === 'avatar') {
      if (current.scope === 'header' || current.used.avatar) {
        throw new ForbiddenException({ code: ErrorCodes.UNAUTHORIZED });
      }
      current.used.avatar = true;
    } else {
      if (current.scope === 'avatar' || current.used.header) {
        throw new ForbiddenException({ code: ErrorCodes.UNAUTHORIZED });
      }
      current.used.header = true;
    }

    const scopeExhausted =
      (current.scope === 'avatar' && current.used.avatar) ||
      (current.scope === 'header' && current.used.header) ||
      (current.scope === 'avatar+header' &&
        current.used.avatar &&
        current.used.header);

    if (scopeExhausted) {
      this.deleteRecord(address, records, current.scope);
    }
  }

  private pruneExpiredRecords(
    address: string,
    records: Map<Scope, NonceRecord>,
    now: number,
  ): void {
    for (const [scope, record] of records) {
      if (now > record.expiresAt) {
        records.delete(scope);
      }
    }

    if (records.size === 0) {
      this.addressToNonces.delete(address);
    }
  }

  private deleteRecord(
    address: string,
    records: Map<Scope, NonceRecord>,
    scope: Scope,
  ): void {
    records.delete(scope);
    if (records.size === 0) {
      this.addressToNonces.delete(address);
    }
  }
}
