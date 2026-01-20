import { Module } from '@nestjs/common';
import { CfopService } from './cfop.service';
import { CfopController } from './cfop.controller';
import { PrismaModule } from 'nestjs-prisma';

@Module({
    imports: [PrismaModule],
    controllers: [CfopController],
    providers: [CfopService],
    exports: [CfopService],
})
export class CfopModule { }
