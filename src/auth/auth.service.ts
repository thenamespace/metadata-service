import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SiweMessage } from 'siwe';
import { generateSiweNonce } from 'viem/siwe';
import { ErrorCodes } from '../common/enums/error-codes.enum';

type NonceRecord = { nonce: string; issuedAt: number };

@Injectable()
export class AuthService {
  private addressToNonce: Map<string, NonceRecord> = new Map();

  constructor(private readonly jwtService: JwtService) {}

  generateNonce(address: string): { nonce: string } {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new BadRequestException({ code: ErrorCodes.INVALID_ADDRESS, details: { address } });
    }
    const nonce = generateSiweNonce();
    const issuedAt = Date.now();
    this.addressToNonce.set(address.toLowerCase(), { nonce, issuedAt });

    return { nonce };
  }

  async verifySignature(params: {
    message: string;
    signature: string;
    address: string;
  }): Promise<{ token: string; address: string; expiresIn: number }> {
    const { message, signature, address } = params;

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
      if (!fields.success || siwe.address.toLowerCase() !== lower || siwe.nonce !== record.nonce) {
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

      // Nonce age limit to prevent replay even if message lacks expirationTime
      const NONCE_TTL_MS = Number(process.env.SIWE_NONCE_TTL_MS || 5 * 60 * 1000); // default 5 minutes
      if (Date.now() - record.issuedAt > NONCE_TTL_MS) {
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
      // Normalize any SIWE parsing/verification/runtime errors to a controlled 401
      throw new UnauthorizedException({ code: ErrorCodes.SIGNATURE_VERIFICATION_FAILED });
    }

    // Invalidate nonce
    this.addressToNonce.delete(lower);

    const expiresIn = 60 * 60 * 24; // 1 day
    const token = await this.jwtService.signAsync({ sub: lower, address: lower }, { expiresIn });
    return { token, address: lower, expiresIn };
  }


}


