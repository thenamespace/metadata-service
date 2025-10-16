import { Injectable, BadRequestException, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SiweMessage } from 'siwe';
import { createPublicClient, http } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { verifyMessage as ambireVerifyMessage } from '@ambire/signature-validator';
import { generateSiweNonce } from 'viem/siwe';
import { isAddress } from 'viem';
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
  private readonly logger = new Logger(AuthService.name);
  private addressToNonce: Map<string, NonceRecord> = new Map();
  private readonly mainnetClient: ReturnType<typeof createPublicClient>;
  private readonly sepoliaClient: ReturnType<typeof createPublicClient>;

  constructor(private readonly configService: ConfigService) {
    const alchemyApiKey = this.configService.get<string>('ALCHEMY_API_KEY');

    const mainnetUrl = `https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`

    this.mainnetClient = createPublicClient({
      chain: mainnet,
      transport: http(mainnetUrl),
    });

    const sepoliaUrl = `https://eth-sepolia.g.alchemy.com/v2/${alchemyApiKey}`

    this.sepoliaClient = createPublicClient({
      chain: sepolia,
      transport: http(sepoliaUrl),
    });
  }

  generateNonce(address: string, scope?: Scope): { nonce: string; expiresAt: number } {
    if (!isAddress(address)) {
      throw new BadRequestException({ code: ErrorCodes.INVALID_ADDRESS, details: { address } });
    }
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

  private getAllowedChainIds(): number[] {
    const configValue = this.configService.get<string>('SIWE_ALLOWED_CHAIN_IDS');
    
    // Default to mainnet and sepolia if not configured
    if (!configValue) {
      return [1, 11155111]; // mainnet, sepolia
    }

    return configValue
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v));
  }

  private getRpcClientForChainId(chainId: number): ReturnType<typeof createPublicClient> {
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

  async verifySiweAndConsume(params: {
    action: Action;
    message: string;
    signature: string;
    address: string;
  }): Promise<{ address: string }> {
    const { action, message, signature, address } = params;

    this.logger.log(`Starting signature verification for address: ${address}, action: ${action}`);

    if (!isAddress(address)) {
      this.logger.warn(`Invalid address format: ${address}`);
      throw new BadRequestException({ code: ErrorCodes.INVALID_ADDRESS, details: { address } });
    }
    const lower = address.toLowerCase();
    const record = this.addressToNonce.get(lower);
    if (!record) {
      this.logger.warn(`No nonce found for address: ${address}`);
      throw new UnauthorizedException({ code: ErrorCodes.NONCE_NOT_FOUND, details: { address } });
    }

    try {
      const siwe = new SiweMessage(message);
      
      // Get the appropriate RPC client based on chain ID from SIWE message
      const chainId = Number(siwe.chainId);
      const rpcClient = this.getRpcClientForChainId(chainId);
      
      this.logger.log(`Using RPC client for chain ID: ${chainId}`);
      
      // Detect smart contract signatures (longer than standard 65-byte signatures)
      const isSmartContractSignature = signature.length > 132; // 0x + 130 hex chars = 132
      const isLikelyErc6492 = signature.toLowerCase().includes('6492');
      const shouldUseAmbire = isSmartContractSignature || isLikelyErc6492;

      this.logger.log(`Signature analysis - Length: ${signature.length}, IsSmartContract: ${isSmartContractSignature}, IsERC6492: ${isLikelyErc6492}, UseAmbire: ${shouldUseAmbire}`);

      let isValid = false;
      if (shouldUseAmbire) {
        // Use Ambire validator for smart contract signatures
        this.logger.log(`Using Ambire verification for smart contract signature on chain ${chainId}`);
        try {
          isValid = await ambireVerifyMessage({
            signer: address,
            message,
            signature,
            provider: rpcClient,
          });
          this.logger.log(`Ambire verification result: ${isValid}`);
        } catch (error) {
          this.logger.error(`Ambire verification failed: ${error.message}`, error.stack);
          throw new UnauthorizedException({ 
            code: ErrorCodes.SMART_CONTRACT_SIGNATURE_VERIFICATION_FAILED,
            details: { 
              message: 'Smart contract signature verification failed',
              error: error.message as string,
              chainId: chainId
            }
          });
        }
      } else {
        // Default SIWE verification path for standard EOA signatures
        this.logger.log(`Using SIWE verification for EOA signature on chain ${chainId}`);
        try {
          const fields = await siwe.verify({ signature, nonce: record.nonce });
          isValid = !!fields.success;
          this.logger.log(`SIWE verification result: ${isValid}`);
        } catch (error) {
          this.logger.error(`SIWE verification failed: ${error.message}`, error.stack);
          throw new UnauthorizedException({ 
            code: ErrorCodes.EOA_SIGNATURE_VERIFICATION_FAILED,
            details: { 
              message: 'EOA signature verification failed',
              error: error.message as string,
              chainId: chainId
            }
          });
        }
      }

      if (!isValid) {
        this.logger.warn(`Signature verification failed for address: ${address}`);
        throw new UnauthorizedException({ 
          code: shouldUseAmbire ? ErrorCodes.SMART_CONTRACT_SIGNATURE_VERIFICATION_FAILED : ErrorCodes.EOA_SIGNATURE_VERIFICATION_FAILED,
          details: { message: 'Signature verification failed' }
        });
      }

      // Additional SIWE constraints irrespective of verification path
      if (siwe.address.toLowerCase() !== lower) {
        this.logger.warn(`Address mismatch - SIWE: ${siwe.address.toLowerCase()}, Expected: ${lower}`);
        throw new UnauthorizedException({ 
          code: ErrorCodes.ADDRESS_MISMATCH,
          details: { 
            message: 'Address in signature does not match provided address',
            siweAddress: siwe.address,
            providedAddress: address
          }
        });
      }
      if (siwe.nonce !== record.nonce) {
        this.logger.warn(`Nonce mismatch - SIWE: ${siwe.nonce}, Expected: ${record.nonce}`);
        throw new UnauthorizedException({ 
          code: ErrorCodes.NONCE_MISMATCH,
          details: { 
            message: 'Nonce in signature does not match expected nonce',
            siweNonce: siwe.nonce,
            expectedNonce: record.nonce
          }
        });
      }

      // Reject expired or not-yet-valid SIWE messages if provided
      const now = new Date();
      if (siwe.expirationTime && new Date(siwe.expirationTime) < now) {
        this.logger.warn(`Signature expired - Expiration: ${siwe.expirationTime}, Now: ${now.toISOString()}`);
        throw new UnauthorizedException({ 
          code: ErrorCodes.SIGNATURE_EXPIRED,
          details: { 
            message: 'Signature has expired',
            expirationTime: siwe.expirationTime,
            currentTime: now.toISOString()
          }
        });
      }
      if (siwe.notBefore && new Date(siwe.notBefore) > now) {
        this.logger.warn(`Signature not yet valid - NotBefore: ${siwe.notBefore}, Now: ${now.toISOString()}`);
        throw new UnauthorizedException({ 
          code: ErrorCodes.SIGNATURE_EXPIRED,
          details: { 
            message: 'Signature is not yet valid',
            notBefore: siwe.notBefore,
            currentTime: now.toISOString()
          }
        });
      }

      // Nonce lifetime
      if (Date.now() > record.expiresAt) {
        this.logger.warn(`Nonce expired - ExpiresAt: ${record.expiresAt}, Now: ${Date.now()}`);
        this.addressToNonce.delete(lower);
        throw new UnauthorizedException({ 
          code: ErrorCodes.SIGNATURE_EXPIRED,
          details: { 
            message: 'Nonce has expired',
            expiresAt: record.expiresAt,
            currentTime: Date.now()
          }
        });
      }

      // Validate allowed chain IDs (mainnet: 1, sepolia: 11155111)
      const allowedChainIds = this.getAllowedChainIds();
      if (allowedChainIds.length > 0 && !allowedChainIds.includes(Number(siwe.chainId))) {
        this.logger.warn(`Invalid chain ID - ChainId: ${siwe.chainId}, Allowed: ${allowedChainIds.join(', ')}`);
        throw new UnauthorizedException({ 
          code: ErrorCodes.INVALID_CHAIN_ID,
          details: { 
            message: 'Chain ID not allowed',
            chainId: siwe.chainId,
            allowedChainIds 
          }
        });
      }

      this.logger.log(`Signature verification successful for address: ${address}`);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error; // Re-throw our specific exceptions
      }
      this.logger.error(`Unexpected error during signature verification: ${error.message}`, error.stack);
      throw new UnauthorizedException({ 
        code: ErrorCodes.SIGNATURE_VERIFICATION_FAILED,
        details: { 
          message: 'Unexpected error during signature verification',
          error: error.message as string,
        }
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


