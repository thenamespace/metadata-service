import { Injectable, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SiweMessage } from 'siwe';
import { createPublicClient, http, PublicClient } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { verifyMessage as ambireVerifyMessage } from '@ambire/signature-validator';
import { generateSiweNonce } from 'viem/siwe';
import { ErrorCodes } from '../common/enums/error-codes.enum';

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
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private addressToNonce: Map<string, NonceRecord> = new Map();
  private readonly mainnetClient: PublicClient;
  private readonly sepoliaClient: PublicClient;

  constructor(private readonly configService: ConfigService) {
    const alchemyApiKey = this.configService.get<string>('ALCHEMY_API_KEY');
    
    if (!alchemyApiKey) {
      throw new Error('ALCHEMY_API_KEY environment variable is required');
    }

    const mainnetUrl = `https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`;
    const sepoliaUrl = `https://eth-sepolia.g.alchemy.com/v2/${alchemyApiKey}`;

    this.mainnetClient = createPublicClient({
      chain: mainnet,
      transport: http(mainnetUrl),
    });

    this.sepoliaClient = createPublicClient({
      chain: sepolia,
      transport: http(sepoliaUrl),
    });

    this.logger.log('AuthService initialized successfully');
  }


  generateNonce(address: string, scope?: Scope): { nonce: string; expiresAt: number } {
    const nonce = generateSiweNonce();
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

  private getRpcClientForChainId(chainId: number): PublicClient {
    switch (chainId) {
      case 1: // mainnet
        return this.mainnetClient;
      case 11155111: // sepolia
        return this.sepoliaClient;
      default:
        this.logger.warn(`Unsupported chain ID: ${chainId}, defaulting to mainnet`);
        return this.mainnetClient;
    }
  }

  async verifySiweAndConsume(params: VerificationParams): Promise<{ address: string }> {
    const { action, message, signature, address } = params;

    this.logger.log(`Starting signature verification for address: ${address}, action: ${action}`);

    const lower = address.toLowerCase();
    const record = this.addressToNonce.get(lower);
    if (!record) {
      throw new UnauthorizedException({ code: ErrorCodes.NONCE_NOT_FOUND, details: { address } });
    }

    try {
      const siwe = new SiweMessage(message);
      const chainId = Number(siwe.chainId);
      const rpcClient = this.getRpcClientForChainId(chainId);
      
      // Detect smart contract signatures
      const isSmartContractSignature = signature.length > 132;
      const isLikelyErc6492 = signature.toLowerCase().includes('6492');
      const shouldUseAmbire = isSmartContractSignature || isLikelyErc6492;

      let isValid = false;
      if (shouldUseAmbire) {
        // Use Ambire validator for smart contract signatures
        isValid = await ambireVerifyMessage({
          signer: address,
          message,
          signature,
          provider: rpcClient,
        });
      } else {
        // Default SIWE verification for EOA signatures
        const fields = await siwe.verify({ signature, nonce: record.nonce });
        isValid = !!fields.success;
      }

      if (!isValid) {
        throw new UnauthorizedException({ 
          code: shouldUseAmbire ? ErrorCodes.SMART_CONTRACT_SIGNATURE_VERIFICATION_FAILED : ErrorCodes.EOA_SIGNATURE_VERIFICATION_FAILED,
          details: { message: 'Signature verification failed' }
        });
      }

      // Validate SIWE constraints
      if (siwe.address.toLowerCase() !== lower) {
        throw new UnauthorizedException({ 
          code: ErrorCodes.ADDRESS_MISMATCH,
          details: { message: 'Address in signature does not match provided address' }
        });
      }
      if (siwe.nonce !== record.nonce) {
        throw new UnauthorizedException({ 
          code: ErrorCodes.NONCE_MISMATCH,
          details: { message: 'Nonce in signature does not match expected nonce' }
        });
      }

      // Check expiration
      const now = new Date();
      if (siwe.expirationTime && new Date(siwe.expirationTime) < now) {
        throw new UnauthorizedException({ 
          code: ErrorCodes.SIGNATURE_EXPIRED,
          details: { message: 'Signature has expired' }
        });
      }
      if (siwe.notBefore && new Date(siwe.notBefore) > now) {
        throw new UnauthorizedException({ 
          code: ErrorCodes.SIGNATURE_EXPIRED,
          details: { message: 'Signature is not yet valid' }
        });
      }

      // Check nonce expiration
      if (Date.now() > record.expiresAt) {
        this.addressToNonce.delete(lower);
        throw new UnauthorizedException({ 
          code: ErrorCodes.SIGNATURE_EXPIRED,
          details: { message: 'Nonce has expired' }
        });
      }

      // Validate allowed chain IDs
      const allowedChainIds = (this.configService.get<string>('SIWE_ALLOWED_CHAIN_IDS') || '1,11155111')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v));
      
      if (allowedChainIds.length > 0 && !allowedChainIds.includes(Number(siwe.chainId))) {
        throw new UnauthorizedException({ 
          code: ErrorCodes.INVALID_CHAIN_ID,
          details: { message: 'Chain ID not allowed' }
        });
      }

      this.logger.log(`Signature verification successful for address: ${address}`);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error(`Unexpected error during signature verification: ${error.message}`, error.stack);
      throw new UnauthorizedException({ 
        code: ErrorCodes.SIGNATURE_VERIFICATION_FAILED,
        details: { message: 'Unexpected error during signature verification' }
      });
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


