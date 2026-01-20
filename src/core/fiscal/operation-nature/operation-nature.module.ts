import { Module } from '@nestjs/common';
import { OperationNatureService } from './operation-nature.service';
import { OperationNatureController } from './operation-nature.controller';
import { PrismaModule } from 'nestjs-prisma';

@Module({
    imports: [PrismaModule],
    controllers: [OperationNatureController],
    providers: [OperationNatureService],
    exports: [OperationNatureService],
})
export class OperationNatureModule { }
