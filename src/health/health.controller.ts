import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  public getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'metadata-service',
    };
  }
}
