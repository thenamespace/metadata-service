import { ServiceUnavailableException } from '@nestjs/common';
import {
  Address,
  createPublicClient,
  keccak256,
  namehash,
  parseAbi,
  stringToHex,
  toHex,
  zeroAddress,
} from 'viem';
import { getEnsAddress, packetToBytes } from 'viem/ens';
import { FileType } from '../common/enums/file-type.enum';

export type UploadAuthorization = 'allowed' | 'denied' | 'pending';

export interface EnsV2Contracts {
  helper: Address;
  v1Resolver: Address;
  publicResolver?: Address;
}

// ENS deployment source: 07e55a056f5b6a9c90119f501bdd05714e67dddd.
const abi = parseAbi([
  'function ROOT_REGISTRY() view returns (address)',
  'function findExactOwner(bytes name) view returns (address)',
  'function findResolver(bytes name) view returns (address resolver, bytes32 node, uint256 offset)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'function hasRoles(uint256 resource, uint256 roleBitmap, address account) view returns (bool)',
  'function canModifyName(bytes32 node, address operator) view returns (bool)',
]);

export async function getEnsV2Authorization(
  client: ReturnType<typeof createPublicClient>,
  contracts: EnsV2Contracts,
  name: string,
  wallet: Address,
  recordKey: FileType,
): Promise<UploadAuthorization> {
  const universalResolver =
    client.chain?.contracts?.ensUniversalResolver?.address;
  if (!universalResolver) {
    throw new ServiceUnavailableException('ENS Universal Resolver unavailable');
  }
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const [helperRoot, resolverRoot] = await Promise.all([
    client.readContract({
      address: contracts.helper,
      abi,
      functionName: 'ROOT_REGISTRY',
      blockNumber,
    }),
    client.readContract({
      address: universalResolver,
      abi,
      functionName: 'ROOT_REGISTRY',
      blockNumber,
    }),
  ]);
  if (
    helperRoot === zeroAddress ||
    helperRoot.toLowerCase() !== resolverRoot.toLowerCase()
  ) {
    throw new ServiceUnavailableException(
      'ENS helper does not match the active registry',
    );
  }

  const dnsName = toHex(packetToBytes(name));
  const owner = await client.readContract({
    address: contracts.helper,
    abi,
    functionName: 'findExactOwner',
    args: [dnsName],
    blockNumber,
  });
  if (owner !== zeroAddress && owner.toLowerCase() === wallet.toLowerCase())
    return 'allowed';

  const [resolver, , offset] = await client.readContract({
    address: universalResolver,
    abi,
    functionName: 'findResolver',
    args: [dnsName],
    blockNumber,
  });
  if (resolver.toLowerCase() === contracts.v1Resolver.toLowerCase()) {
    // A registered V2 name must never regain address-based authorization.
    if (owner !== zeroAddress) return 'denied';
    // Keep the V1 address read at the same block as the route check. Never use
    // the legacy cache, which may contain a result from before migration.
    const address = await getEnsAddress(client, { name, blockNumber });
    if (address === null) return 'pending';
    return address.toLowerCase() === wallet.toLowerCase()
      ? 'allowed'
      : 'denied';
  }
  if (resolver === zeroAddress)
    return owner === zeroAddress ? 'pending' : 'denied';

  let allowed: boolean;
  if (contracts.publicResolver?.toLowerCase() === resolver.toLowerCase()) {
    // PublicResolverV2 cannot resolve descendants through wildcard inheritance.
    if (offset !== 0n) return owner === zeroAddress ? 'pending' : 'denied';
    allowed = await client.readContract({
      address: resolver,
      abi,
      functionName: 'canModifyName',
      args: [namehash(name), wallet],
      blockNumber,
    });
  } else {
    const supported = await client.readContract({
      address: resolver,
      abi,
      functionName: 'supportsInterface',
      args: ['0x8c2427cc'],
      blockNumber,
    });
    if (!supported) {
      throw new ServiceUnavailableException(
        'ENS resolver editor permissions are unsupported',
      );
    }
    // PermissionedResolver includes root grants in hasRoles; resources are text keys, not names.
    allowed = await client.readContract({
      address: resolver,
      abi,
      functionName: 'hasRoles',
      args: [BigInt(keccak256(stringToHex(recordKey))), 1n << 4n, wallet],
      blockNumber,
    });
  }
  if (allowed) return 'allowed';
  if (owner !== zeroAddress) return 'denied';
  // An uncreated child can inherit its parent's resolver. A missing address
  // permits staging an upload, but never grants V2 write authorization.
  const address = await getEnsAddress(client, {
    name,
    blockNumber,
    strict: true,
  });
  return address === null ? 'pending' : 'denied';
}
