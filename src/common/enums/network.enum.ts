export enum Network {
  MAINNET = 'mainnet',
  SEPOLIA = 'sepolia',
}

export const SUPPORTED_NETWORKS = Object.values(Network);

export function isValidNetwork(network: string): network is Network {
  return SUPPORTED_NETWORKS.includes(network as Network);
}

export function getNetworkPath(network: Network): string {
  switch (network) {
    case Network.MAINNET:
      return '';
    case Network.SEPOLIA:
      return 'sepolia/';
    default:
      throw new Error(`Unsupported network: ${network}`);
  }
}
