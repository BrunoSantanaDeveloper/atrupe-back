import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AcademyService } from './academy.service';
import { CreateAcademySystemDto } from './dto/create-academy-system.dto';
import { UpdateAcademySystemDto } from './dto/update-academy-system.dto';
import { CreateAcademyProgressDto } from './dto/create-academy-progress.dto';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

@Controller('academy')
export class AcademyController {
  constructor(private readonly academyService: AcademyService) {}
  @Get('extract')
  async getExtra() {
    return await this.academyService.extractData();
  }
  @Post('')
  createAcademySystem(@Body() data: CreateAcademySystemDto) {
    return this.academyService.createAcademySystem(data);
  }

  @Patch(':id')
  updateAcademySystem(
    @Param('id') id: string,
    @Body() data: UpdateAcademySystemDto,
  ) {
    return this.academyService.updateAcademySystem(id, data);
  }

  @Delete(':id')
  deleteAcademySystem(@Param('id') id: string) {
    return this.academyService.deleteAcademySystem(id);
  }

  @Get('help-by-page')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async getHelpDataByPage(@Query('page') page: string) {
    return this.academyService.getHelpDataByPage(page);
  }

  @Get(':type')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async getAcademySystemsByType(@Req() req, @Param('type') type: string) {
    const typeUpper = type.toUpperCase();
    return await this.academyService.getAcademySystemsByType(
      typeUpper,
      req.user.companyId,
    );
  }

  @Post('progress')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async createAcademyProgress(
    @Req() req,
    @Body() data: CreateAcademyProgressDto,
  ) {
    data.companyId = req.user.companyId;
    return await this.academyService.createAcademyProgress(data);
  }
}
