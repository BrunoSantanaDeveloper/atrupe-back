import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class CacheService {
  constructor(@Inject(CACHE_MANAGER) private cache: Cache) {}

  async get<T = unknown>(key: string) {
    return this.cache.get<T>(key);
  }

  async set(key: string, value: any, seconds = 86400000 /* 1 day */) {
    return this.cache.set(key, value, seconds);
  }

  async del(key: string) {
    return this.cache.del(key);
  }
}
