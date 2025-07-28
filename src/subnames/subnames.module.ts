import { Module } from '@nestjs/common';
import { SubnamesClientService } from './subnames-client.service';
import { AppPropertiesModule } from '../properties/app-properties.module';

@Module({
  imports: [AppPropertiesModule],
  providers: [SubnamesClientService],
  exports: [SubnamesClientService],
})
export class SubnamesModule {}
