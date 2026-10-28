import { getEnsV2Contracts } from '@thenamespace/addresses';
import { Network } from '../common/enums/network.enum';
import type { EnsV2Contracts } from './ens-v2-authorization';

const sepolia = getEnsV2Contracts(true);

// Networks without an entry retain the existing V1 authorization path.
export const ENS_V2_CONTRACTS: Partial<Record<Network, EnsV2Contracts>> = {
  [Network.SEPOLIA]: {
    helper: sepolia.universalHelper,
    v1Resolver: sepolia.ensV1Resolver,
    publicResolver: sepolia.publicResolverV2,
  },
};
