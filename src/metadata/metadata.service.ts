import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { getNetworkForChain, isTestnet, SupportedChain } from '../web3/types';
import { toHex } from 'viem';
import { ImageService } from './image.service';
import { AppProperties } from '../properties/app.properties';
import { SubnamesClientService } from '../subnames/subnames-client.service';

@Injectable()
export class MetadataService {
  constructor(
    private readonly subnameService: SubnamesClientService,
    private readonly avatarService: ImageService,
    private readonly appProperties: AppProperties,
  ) {}

  public async getMetadata(tokenId: string, chainIdStr: string) {
    let chainId: number;
    let node: string;
    let networkName: SupportedChain | null;

    try {
      node = this.tokenIdToBytes32(tokenId);
      chainId = parseInt(chainIdStr, 10);

      if (isNaN(chainId)) {
        throw new Error('Invalid chain ID');
      }

      networkName = getNetworkForChain(chainId);

      if (!networkName) {
        throw Error('Unsupported chainId');
      }

      if (isTestnet(networkName)) {
        return null;
      }
    } catch {
      throw new BadRequestException('Invalid parameters');
    }

    Logger.log(`Request for metadata token: ${tokenId}, chain: ${chainIdStr}`);

    const nodeDTO = await this.subnameService.getL2Subname(node, chainId);
    const metadata = {
      name: nodeDTO.name,
      desciption: 'ENS subnames on ' + networkName,
      image: `${this.appProperties.metadataURL}/metadata/network/${chainIdStr}/token/${tokenId}/image.png`,
    };
    Logger.log(`Resolved metadata request:`, metadata);
    return metadata;
  }

  public async getMetadataImage(tokenId: string, chainIdStr: string) {
    let chainId: number;
    let node: string;
    let networkName: string | null;

    try {
      node = this.tokenIdToBytes32(tokenId);
      chainId = parseInt(chainIdStr, 10);

      if (isNaN(chainId)) {
        throw new Error('Invalid chain ID');
      }

      networkName = getNetworkForChain(chainId);
      if (!networkName) {
        throw Error('Unsupported chainId');
      }

      const cachedImage = this.avatarService.getCachedImage(node);
      if (cachedImage && cachedImage.stream) {
        return cachedImage.stream;
      }
    } catch {
      throw new BadRequestException('Invalid parameters');
    }
    const nodeDTO = await this.subnameService.getL2Subname(node, chainId);
    return this.avatarService.generateImageForName(
      nodeDTO.name,
      nodeDTO.avatar,
    );
  }

  private tokenIdToBytes32(tokenId: string) {
    return toHex(BigInt(tokenId || '0'));
  }
}
