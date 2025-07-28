import { Chain } from 'viem';
import {
  base as baseChain,
  baseSepolia,
  mainnet,
  optimism,
  sepolia as sepoliaChain,
} from 'viem/chains';

export type Web3Network = 'sepolia' | 'mainnet';
export type L2Network = 'base' | 'baseSepolia' | 'optimism';
export type SupportedChain = Web3Network | L2Network;

const chains: Record<SupportedChain, Chain> = {
  base: baseChain,
  sepolia: sepoliaChain,
  mainnet: mainnet,
  baseSepolia: baseSepolia,
  optimism: optimism,
};

export const getChain = (network: SupportedChain): Chain => {
  return chains[network];
};

export const getNetworkForChain = (chainId: number): SupportedChain | null => {
  for (const chainName of Object.keys(chains)) {
    const typedChainName = chainName as SupportedChain;
    if (chains[typedChainName].id === chainId) {
      return typedChainName;
    }
  }
  return null;
};

export const isTestnet = (network: SupportedChain): boolean => {
  if (!network) {
    return true;
  }

  return ['sepolia', 'baseSepolia'].includes(network);
};
