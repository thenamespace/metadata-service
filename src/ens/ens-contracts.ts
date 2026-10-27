import { Network } from '../common/enums/network.enum';
import type { EnsV2Contracts } from './ens-v2-authorization';

// Networks without an entry retain the existing V1 authorization path.
export const ENS_V2_CONTRACTS: Partial<Record<Network, EnsV2Contracts>> = {
  // ensdomains/contracts-v2@4f47cbcc11462fb413196e6b5c0f8090247a6c08, deployments/mainnet.
  [Network.MAINNET]: {
    helper: '0x46ae127d14683ac74ef151e46ae2117a1a25c676',
    v1Resolver: '0x394d8eb4a4fdf599384deab25f31d111d755c398',
    publicResolver: '0x66f9f566ff2f26309c1bd9134388478a801da3e1',
  },
  // ensdomains/contracts-v2@07e55a056f5b6a9c90119f501bdd05714e67dddd, deployments/sepolia.
  [Network.SEPOLIA]: {
    helper: '0xd453e5bdb62cc3bea84341b1e306319c8ffd7dfe',
    v1Resolver: '0x322b7581ca210a69c6d0e0d7c88a7688d2789cb0',
    publicResolver: '0xdc4a563d00f5c3012b699794eb9e13a561be386f',
  },
};
