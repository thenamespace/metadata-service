import type { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { createViemConfig, SiweConfig } from '@signinwithethereum/siwe';

/** Injection token: Map<chainId, SiweConfig> built at module init from ALCHEMY_API_KEY. */
export const SIWE_CONFIGS = Symbol('SIWE_CONFIGS');

/** chainId -> SiweConfig bound to that chain's viem PublicClient. */
export type SiweConfigsByChain = Map<number, SiweConfig>;

export const siweConfigsProvider: FactoryProvider<Promise<SiweConfigsByChain>> =
  {
    provide: SIWE_CONFIGS,
    inject: [ConfigService],
    useFactory: async (
      configService: ConfigService,
    ): Promise<SiweConfigsByChain> => {
      const alchemyApiKey = configService.get<string>('ALCHEMY_API_KEY');
      if (!alchemyApiKey) {
        throw new Error('ALCHEMY_API_KEY environment variable is required');
      }

      const mainnetClient = createPublicClient({
        chain: mainnet,
        transport: http(
          `https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
        ),
      });
      const sepoliaClient = createPublicClient({
        chain: sepolia,
        transport: http(
          `https://eth-sepolia.g.alchemy.com/v2/${alchemyApiKey}`,
        ),
      });

      const byChain: SiweConfigsByChain = new Map();
      byChain.set(
        mainnet.id,
        await createViemConfig({ publicClient: mainnetClient }),
      );
      byChain.set(
        sepolia.id,
        await createViemConfig({ publicClient: sepoliaClient }),
      );
      return byChain;
    },
  };
