import { Module } from '@nestjs/common';
import { AppProperties } from './app.properties';

@Module({
  providers: [AppProperties],
  exports: [AppProperties],
})
export class AppPropertiesModule {}
