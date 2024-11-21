import { Module } from '@nestjs/common';
import { BigdatacorpService } from './bigdatacorp.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  providers: [BigdatacorpService],
  exports: [BigdatacorpService],
})
export class BigdatacorpModule {}
