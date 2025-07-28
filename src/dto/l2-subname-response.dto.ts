export class L2SubnameResponse {
  name: string;
  namehash: string;
  owner: string;
  avatar?: string;
  chainId: number;
  expiry: number;
  parentHash: string;
  records: {
    addresses: Record<string, string>;
    texts: Record<string, string>;
    contenthash: string;
  };
  metadata: {
    blockNumber: number;
    price: number;
    fee: number;
    tx: string;
  };
}
