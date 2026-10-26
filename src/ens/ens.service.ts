import {
  Injectable,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Address, createPublicClient, http } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { getEnsAddress, normalize } from 'viem/ens';
import { ErrorCodes } from '../common/enums/error-codes.enum';
import { Network, isValidNetwork } from '../common/enums/network.enum';
import { AvatarObservabilityService } from '../observability/avatar-observability.service';
import { FileType } from '../common/enums/file-type.enum';
import {
  getEnsV2Authorization,
  UploadAuthorization,
} from './ens-v2-authorization';
import { ENS_V2_CONTRACTS } from './ens-contracts';

type CacheEntry = { owner: string; fetchedAt: number };

/**
 * ENS service to verify subname ownership against an EVM address.
 * Supports both mainnet and sepolia networks with separate clients and caching.
 */
@Injectable()
export class EnsService {
  private cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 5 * 60 * 1000; // 5 minutes
  private readonly mainnetClient: ReturnType<typeof createPublicClient>;
  private readonly sepoliaClient: ReturnType<typeof createPublicClient>;

  constructor(
    private readonly config: ConfigService,
    private readonly observability: AvatarObservabilityService,
  ) {
    const alchemyApiKey = this.config.get<string>('ALCHEMY_API_KEY');
    const mainnetRpcUrl = this.config.get<string>('ETH_MAINNET_RPC_URL');
    const sepoliaRpcUrl = this.config.get<string>('ETH_SEPOLIA_RPC_URL');

    // Mainnet client
    const mainnetUrl =
      mainnetRpcUrl ||
      (alchemyApiKey
        ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`
        : undefined);

    this.mainnetClient = createPublicClient({
      chain: mainnet,
      transport: mainnetUrl ? http(mainnetUrl) : http(),
    });

    // Sepolia client
    const sepoliaUrl =
      sepoliaRpcUrl ||
      (alchemyApiKey
        ? `https://eth-sepolia.g.alchemy.com/v2/${alchemyApiKey}`
        : undefined);

    this.sepoliaClient = createPublicClient({
      chain: sepolia,
      transport: sepoliaUrl ? http(sepoliaUrl) : http(),
    });
  }

  async assertOwnerOrThrow(params: {
    subname: string;
    address: string;
    network: Network;
    recordKey: FileType;
  }): Promise<void> {
    const { subname, network } = params;

    if (!isValidNetwork(network)) {
      throw new BadRequestException({
        code: ErrorCodes.INVALID_SUBNAME_FORMAT,
        details: { network },
      });
    }

    const ens = subname.trim();
    if (!ens) {
      throw new BadRequestException({
        code: ErrorCodes.INVALID_SUBNAME_FORMAT,
        details: { subname },
      });
    }
    let normalized: string;
    try {
      normalized = normalize(ens);
    } catch {
      this.observability.recordEnsLookup(
        network,
        'not_applicable',
        'invalid_name',
        0,
      );
      throw new BadRequestException({
        code: ErrorCodes.INVALID_SUBNAME_FORMAT,
        details: { subname },
      });
    }
    const authorization = await this.getUploadAuthorization({
      ...params,
      subname: normalized,
    });
    if (authorization !== 'allowed') {
      throw new ForbiddenException({
        code: ErrorCodes.NOT_SUBNAME_OWNER,
        details: { subname, network },
      });
    }
  }

  async getUploadAuthorization(params: {
    subname: string;
    network: Network;
    address: string;
    recordKey: FileType;
  }): Promise<UploadAuthorization> {
    const { subname, network, address, recordKey } = params;
    if (!isValidNetwork(network)) {
      throw new BadRequestException({
        code: ErrorCodes.INVALID_SUBNAME_FORMAT,
      });
    }
    const contracts = ENS_V2_CONTRACTS[network];
    if (contracts) {
      const startedAt = process.hrtime.bigint();
      let name: string;
      try {
        name = normalize(subname.trim());
      } catch {
        this.observability.recordEnsLookup(
          network,
          'not_applicable',
          'invalid_name',
          Number(process.hrtime.bigint() - startedAt) / 1e9,
        );
        throw new BadRequestException({
          code: ErrorCodes.INVALID_SUBNAME_FORMAT,
        });
      }
      try {
        const decision = await getEnsV2Authorization(
          network === Network.MAINNET ? this.mainnetClient : this.sepoliaClient,
          contracts,
          name,
          address as Address,
          recordKey,
        );
        this.observability.recordEnsLookup(
          network,
          'not_applicable',
          decision,
          Number(process.hrtime.bigint() - startedAt) / 1e9,
        );
        return decision;
      } catch (error) {
        this.observability.recordEnsLookup(
          network,
          'not_applicable',
          'rpc_error',
          Number(process.hrtime.bigint() - startedAt) / 1e9,
        );
        throw error;
      }
    }
    const owner = await this.getOwnerOrNull({ subname, network });
    if (owner === null) return 'pending';
    return owner.toLowerCase() === address.toLowerCase() ? 'allowed' : 'denied';
  }

  /**
   * Get the owner address for an ENS name without throwing errors.
   * Returns null if the ENS record doesn't exist.
   * Used for checking ENS records before deciding upload flow.
   */
  async getOwnerOrNull(params: {
    subname: string;
    network: Network;
  }): Promise<string | null> {
    const { subname, network } = params;

    // if (!isValidNetwork(network)) {
    //   return null;
    // }

    const ens = subname.trim();
    if (!ens) {
      return null;
    }

    let normalized: string;
    try {
      normalized = normalize(ens);
    } catch {
      this.observability.recordEnsLookup(
        network,
        'not_applicable',
        'invalid_name',
        0,
      );
      return null;
    }

    return await this.getDefaultAddressRecord(normalized, network);
  }

  private async getDefaultAddressRecord(
    name: string,
    network: Network,
  ): Promise<string | null> {
    const startedAt = process.hrtime.bigint();
    const key = `${network}:${name.toLowerCase()}`;
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && now - cached.fetchedAt < this.ttlMs) {
      this.observability.recordEnsLookup(
        network,
        'hit',
        cached.owner ? 'found' : 'not_found',
        Number(process.hrtime.bigint() - startedAt) / 1e9,
      );
      // Return null if cached owner is empty string
      return cached.owner || null;
    }

    const client =
      network === Network.MAINNET ? this.mainnetClient : this.sepoliaClient;
    try {
      const owner = await getEnsAddress(client, { name: normalize(name) });
      this.cache.set(key, { owner: owner ?? '', fetchedAt: now });
      this.observability.recordEnsLookup(
        network,
        'miss',
        owner ? 'found' : 'not_found',
        Number(process.hrtime.bigint() - startedAt) / 1e9,
      );
      return owner;
    } catch (error) {
      this.observability.recordEnsLookup(
        network,
        'miss',
        'rpc_error',
        Number(process.hrtime.bigint() - startedAt) / 1e9,
      );
      throw error;
    }
  }
}
