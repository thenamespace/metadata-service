import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { getEnsAddress, normalize } from 'viem/ens';
import { ErrorCodes } from '../common/enums/error-codes.enum';

type CacheEntry = { owner: string; fetchedAt: number };

/**
 * ENS service to verify subname ownership against an EVM address.
 * Uses viem on mainnet with a small TTL cache.
 */
@Injectable()
export class EnsService {
  private cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 5 * 60 * 1000; // 5 minutes
  private readonly client: ReturnType<typeof createPublicClient>;

  constructor(private readonly config: ConfigService) {
    const alchemyApiKey = this.config.get<string>('ALCHEMY_API_KEY');
    const rpcUrlFromEnv = this.config.get<string>('ETH_MAINNET_RPC_URL');

    const rpcUrl = rpcUrlFromEnv
      || (alchemyApiKey ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}` : undefined);

    this.client = createPublicClient({
      chain: mainnet,
      transport: rpcUrl ? http(rpcUrl) : http(),
    });
  }

  async assertOwnerOrThrow(params: { subname: string; address: string }): Promise<void> {
    const { subname, address } = params;
    const ens = subname.trim();
    if (!ens || ens.includes('..')) {
      throw new BadRequestException({ code: ErrorCodes.INVALID_SUBNAME_FORMAT, details: { subname } });
    }
    const owner = await this.getOwner(ens);
    if (!owner || owner.toLowerCase() !== address.toLowerCase()) {
      throw new ForbiddenException({ code: ErrorCodes.NOT_SUBNAME_OWNER, details: { subname } });
    }
  }

  private async getOwner(name: string): Promise<string | null> {
    const key = name.toLowerCase();
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && now - cached.fetchedAt < this.ttlMs) return cached.owner;

    const owner = await getEnsAddress(this.client, { name: normalize(name) });
    this.cache.set(key, { owner: owner ?? '', fetchedAt: now });
    return owner;
  }
}


