import { Controller, Get, Param, StreamableFile } from '@nestjs/common';
import { MetadataService } from './metadata.service';
import { ApiOperation, ApiParam } from '@nestjs/swagger';

@Controller('/metadata')
export class MetadataController {
  constructor(private readonly metadataService: MetadataService) {}

  @Get('/network/:chainId/token/:tokenId')
  @ApiOperation({ summary: 'Get metadata of name by chain ID and token ID' })
  @ApiParam({ name: 'chainId', description: 'The chain ID to query' })
  @ApiParam({ name: 'tokenId', description: 'The token ID to query' })
  public async getMetadata(
    @Param() params: { chainId: string; tokenId: string },
  ) {
    return await this.metadataService.getMetadata(
      params.tokenId,
      params.chainId,
    );
  }

  @Get('/network/:chainId/token/:tokenId/image.png')
  @ApiOperation({
    summary: 'Get avatar image of name by chain ID and token ID',
  })
  @ApiParam({ name: 'chainId', description: 'The chain ID to query' })
  @ApiParam({ name: 'tokenId', description: 'The token ID to query' })
  public async getDefaultAvatar(
    @Param() params: { chainId: string; tokenId: string },
  ): Promise<StreamableFile> {
    const buffer = await this.metadataService.getMetadataImage(
      params.tokenId,
      params.chainId,
    );
    return new StreamableFile(buffer, {
      type: 'image/png',
    });
  }
}
