import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { AppProperties } from '../properties/app.properties';
import { L2SubnameResponse } from '../dto/l2-subname-response.dto';

@Injectable()
export class SubnamesClientService {
  private readonly logger = new Logger(SubnamesClientService.name);
  private readonly httpClient: AxiosInstance;

  constructor(private readonly appProperties: AppProperties) {
    this.httpClient = axios.create({
      baseURL: this.appProperties.indexerServiceURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  public async getL2Subname(
    namehashOrName: string,
    chainId: number,
  ): Promise<L2SubnameResponse> {
    try {
      this.logger.log(
        `Fetching subname: ${namehashOrName}, chainId: ${chainId}`,
      );

      const response = await this.httpClient.get(
        `/l2-subnames/network/${chainId}/subname/${encodeURIComponent(namehashOrName)}`,
      );

      return response.data as L2SubnameResponse;
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(
        `Failed to fetch subname ${namehashOrName} for chain ${chainId}`,
        axiosError.response?.data || axiosError.message,
      );

      if (axiosError.response?.status === 404) {
        throw new NotFoundException(
          `Subname with name/namehash: ${namehashOrName}, chain_id: ${chainId}, not found.`,
        );
      }

      throw error;
    }
  }
}
