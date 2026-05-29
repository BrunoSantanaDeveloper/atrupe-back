import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CouponsService } from './coupons.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';

@ApiTags('Cupons')
@Controller('coupons')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Post('validate')
  @ApiOperation({ summary: 'Valida um cupom de desconto e calcula o desconto' })
  @ApiResponse({
    status: 200,
    description: 'Cupom válido, retorna dados de desconto',
  })
  @ApiResponse({ status: 400, description: 'Cupom inválido ou inelegível' })
  @ApiResponse({ status: 404, description: 'Cupom não encontrado' })
  async validate(@Body() validateCouponDto: ValidateCouponDto, @Req() req) {
    const companyId = req.user.companyId;
    if (!companyId) {
      throw new Error('Empresa não identificada no token do usuário.');
    }

    const coupon = await this.couponsService.validateCoupon(
      validateCouponDto.code,
      companyId,
      validateCouponDto.planId,
      validateCouponDto.isModuleAddition,
    );

    return {
      coupon: {
        id: coupon.id,
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        durationType: coupon.durationType,
        durationMonths: coupon.durationMonths,
        minPlanValue: coupon.minPlanValue,
      },
    };
  }

  @Post()
  @UseGuards(SystemAdminGuard)
  @ApiOperation({ summary: 'Cria um novo cupom de desconto (Admin)' })
  @ApiResponse({ status: 201, description: 'Cupom criado com sucesso' })
  async create(@Body() createCouponDto: CreateCouponDto, @Req() req) {
    const adminUserId = req.user.userId;
    return await this.couponsService.create(createCouponDto, adminUserId);
  }

  @Get()
  @UseGuards(SystemAdminGuard)
  @ApiOperation({ summary: 'Lista todos os cupons de desconto (Admin)' })
  async findAll(
    @Query('isActive') isActive?: string,
    @Query('search') search?: string,
  ) {
    const isActiveFilter =
      isActive === 'true' ? true : isActive === 'false' ? false : undefined;
    return await this.couponsService.findAll({
      isActive: isActiveFilter,
      search,
    });
  }

  @Get(':id')
  @UseGuards(SystemAdminGuard)
  @ApiOperation({ summary: 'Detalha um cupom de desconto (Admin)' })
  async findOne(@Param('id') id: string) {
    return await this.couponsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(SystemAdminGuard)
  @ApiOperation({ summary: 'Atualiza um cupom de desconto (Admin)' })
  async update(
    @Param('id') id: string,
    @Body() updateCouponDto: UpdateCouponDto,
  ) {
    return await this.couponsService.update(id, updateCouponDto);
  }

  @Delete(':id')
  @UseGuards(SystemAdminGuard)
  @ApiOperation({ summary: 'Desativa um cupom de desconto (Admin)' })
  async deactivate(@Param('id') id: string) {
    return await this.couponsService.deactivate(id);
  }

  @Get(':id/usages')
  @UseGuards(SystemAdminGuard)
  @ApiOperation({ summary: 'Lista os usos de um determinado cupom (Admin)' })
  async getUsages(@Param('id') id: string) {
    return await this.couponsService.getUsages(id);
  }
}
