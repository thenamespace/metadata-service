import { Injectable, BadRequestException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { SiweMessage } from 'siwe';
import { generateSiweNonce } from 'viem/siwe';
import { ErrorCodes } from '../common/enums/error-codes.enum';

type Scope = 'avatar' | 'header' | 'avatar+header';
type Action = 'avatar' | 'header';
type NonceRecord = {
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  scope: Scope;
  used: { avatar: boolean; header: boolean };
};

@Injectable()
export class AuthService {
  private addressToNonce: Map<string, NonceRecord> = new Map();

  constructor() {}

  generateNonce(address: string, scope?: Scope): { nonce: string; expiresAt: number } {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new BadRequestException({ code: ErrorCodes.INVALID_ADDRESS, details: { address } });
    }
    const nonce = generateSiweNonce();
    const issuedAt = Date.now();
    const ttlMs = Number(process.env.SIWE_NONCE_TTL_MS || 5 * 60 * 1000);
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

  async verifySiweAndConsume(params: {
    action: Action;
    message: string;
    signature: string;
    address: string;
  }): Promise<{ address: string }> {
    const { action, message, signature, address } = params;

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new BadRequestException({ code: ErrorCodes.INVALID_ADDRESS, details: { address } });
    }
    const lower = address.toLowerCase();
    const record = this.addressToNonce.get(lower);
    if (!record) {
      throw new UnauthorizedException({ code: ErrorCodes.NONCE_NOT_FOUND, details: { address } });
    }

    try {
      const siwe = new SiweMessage(message);
      // Enforce stronger SIWE constraints without pinning to a specific domain/URI
      const fields = await siwe.verify({ signature, nonce: record.nonce });
      if (!fields.success) {
        throw new UnauthorizedException({ code: ErrorCodes.SIGNATURE_VERIFICATION_FAILED });
      }
      if (siwe.address.toLowerCase() !== lower) {
        throw new UnauthorizedException({ code: ErrorCodes.SIGNATURE_VERIFICATION_FAILED });
      }
      if (siwe.nonce !== record.nonce) {
        throw new UnauthorizedException({ code: ErrorCodes.SIGNATURE_VERIFICATION_FAILED });
      }

      // Reject expired or not-yet-valid SIWE messages if provided
      const now = new Date();
      if (siwe.expirationTime && new Date(siwe.expirationTime) < now) {
        throw new UnauthorizedException({ code: ErrorCodes.SIGNATURE_VERIFICATION_FAILED });
      }
      if (siwe.notBefore && new Date(siwe.notBefore) > now) {
        throw new UnauthorizedException({ code: ErrorCodes.SIGNATURE_VERIFICATION_FAILED });
      }

      // Nonce lifetime
      if (Date.now() > record.expiresAt) {
        this.addressToNonce.delete(lower);
        throw new UnauthorizedException({ code: ErrorCodes.SIGNATURE_VERIFICATION_FAILED });
      }

      // Restrict allowed chains if configured
      const allowedChainIds = (process.env.SIWE_ALLOWED_CHAIN_IDS || '1')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v));
      if (allowedChainIds.length > 0 && !allowedChainIds.includes(Number(siwe.chainId))) {
        throw new UnauthorizedException({ code: ErrorCodes.SIGNATURE_VERIFICATION_FAILED });
      }
    } catch {
      throw new UnauthorizedException({ code: ErrorCodes.SIGNATURE_VERIFICATION_FAILED });
    }

    // Scope and consumption checks
    const scope = record.scope;
    if (action === 'avatar') {
      if (scope === 'header') {
        throw new ForbiddenException({ code: ErrorCodes.UNAUTHORIZED });
      }
      if (record.used.avatar) {
        throw new ForbiddenException({ code: ErrorCodes.UNAUTHORIZED });
      }
      record.used.avatar = true;
    } else if (action === 'header') {
      if (scope === 'avatar') {
        throw new ForbiddenException({ code: ErrorCodes.UNAUTHORIZED });
      }
      if (record.used.header) {
        throw new ForbiddenException({ code: ErrorCodes.UNAUTHORIZED });
      }
      record.used.header = true;
    }

    // If both consumed or expired, delete record
    const bothConsumed = record.used.avatar && record.used.header;
    if (bothConsumed || Date.now() > record.expiresAt) {
      this.addressToNonce.delete(lower);
    } else {
      this.addressToNonce.set(lower, record);
    }

    return { address: lower };
  }


}


