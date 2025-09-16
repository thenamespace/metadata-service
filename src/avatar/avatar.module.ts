import { Module } from '@nestjs/common';
import { AvatarController } from './avatar.controller';
import { StorageModule } from '../storage/storage.module';
import { EnsService } from '../ens/ens.service';
import { JwtModule } from '@nestjs/jwt';
import { AvatarService } from './avatar.service';

@Module({
  imports: [JwtModule.register({}), StorageModule],
  controllers: [AvatarController],
  providers: [EnsService, AvatarService],
})
export class AvatarModule {}


