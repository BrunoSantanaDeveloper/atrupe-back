import { Module } from '@nestjs/common';
import { PlugService } from './plug.service';
import { BrasilApiModule } from './brasilapi/brasilapi.module';
import { BigdatacorpModule } from './bigdatacorp/bigdatacorp.module';

@Module({
  providers: [PlugService],
  imports: [BrasilApiModule, BigdatacorpModule],
  exports: [PlugService],
})
export class PlugModule {
  // PlugModule is a singleton
}
