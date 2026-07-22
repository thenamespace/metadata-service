import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createViemConfig, SiweConfig } from '@signinwithethereum/siwe';
import { createPublicClient, http } from 'viem';
import { mainnet, sepolia } from 'viem/chains';

export const SIWE_CONFIGS = Symbol('SIWE_CONFIGS');

export type SiweConfigMap = ReadonlyMap<number, SiweConfig>;

export const siweConfigsProvider: Provider = {
  provide: SIWE_CONFIGS,
  inject: [ConfigService],
  useFactory: async (configService: ConfigService): Promise<SiweConfigMap> => {
    const alchemyApiKey = configService.get<string>('ALCHEMY_API_KEY');
    if (!alchemyApiKey) {
      throw new Error('ALCHEMY_API_KEY environment variable is required');
    }

    const mainnetClient = createPublicClient({
      chain: mainnet,
      transport: http(`https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`),
    });
    const sepoliaClient = createPublicClient({
      chain: sepolia,
      transport: http(`https://eth-sepolia.g.alchemy.com/v2/${alchemyApiKey}`),
    });
    const [mainnetConfig, sepoliaConfig] = await Promise.all([
      createViemConfig({ publicClient: mainnetClient }),
      createViemConfig({ publicClient: sepoliaClient }),
    ]);

    return new Map<number, SiweConfig>([
      [mainnet.id, mainnetConfig],
      [sepolia.id, sepoliaConfig],
    ]);
  },
};
