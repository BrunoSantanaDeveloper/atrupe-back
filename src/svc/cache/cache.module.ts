import { Module } from '@nestjs/common';
import { CacheModule as _CacheModule } from '@nestjs/cache-manager';
import { CacheService } from './cache.service';

@Module({
  imports: [_CacheModule.register()],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
