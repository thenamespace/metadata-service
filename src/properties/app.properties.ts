import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppProperties {
  public metadataURL: string;
  public indexerServiceURL: string;

  constructor(private readonly config: ConfigService) {
    this.metadataURL = this.config.getOrThrow('METADATA_URL');
    this.indexerServiceURL = this.config.getOrThrow('INDEXER_SERVICE_URL');
  }
}
