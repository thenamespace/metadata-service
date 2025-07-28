import { Module } from '@nestjs/common';
import { MetadataController } from './metadata.controller';
import { MetadataService } from './metadata.service';
import { ImageService } from './image.service';
import { AppPropertiesModule } from '../properties/app-properties.module';
import { SubnamesModule } from '../subnames/subnames.module';

@Module({
  imports: [AppPropertiesModule, SubnamesModule],
  controllers: [MetadataController],
  providers: [MetadataService, ImageService],
})
export class MetadataModule {}
