import { getEnsV2Contracts } from '@thenamespace/addresses';
import { Network } from '../common/enums/network.enum';
import type { EnsV2Contracts } from './ens-v2-authorization';

const mainnet = getEnsV2Contracts(false);
const sepolia = getEnsV2Contracts(true);

// Networks without an entry retain the existing V1 authorization path.
export const ENS_V2_CONTRACTS: Partial<Record<Network, EnsV2Contracts>> = {
  [Network.MAINNET]: {
    helper: mainnet.universalHelper,
    v1Resolver: mainnet.ensV1Resolver,
    publicResolver: mainnet.publicResolverV2,
  },
  [Network.SEPOLIA]: {
    helper: sepolia.universalHelper,
    v1Resolver: sepolia.ensV1Resolver,
    publicResolver: sepolia.publicResolverV2,
  },
};
