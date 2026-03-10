import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { SellersService } from './sellers.service';
import { SellersController } from './sellers.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SellersController],
  providers: [SellersService],
})
export class SellersModule {}
