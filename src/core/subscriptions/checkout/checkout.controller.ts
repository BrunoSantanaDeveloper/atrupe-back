import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { IdempotencyInterceptor } from '../../../common/interceptors/idempotency.interceptor';
import {
  CheckoutDto,
  ComplementsDto,
  ComplementsQuoteDto,
  EvolutionDto,
  RegularizationDto,
  RepresentativeCheckDto,
} from '../dto/checkout.dto';
import { CheckoutService, RequestMeta } from './checkout.service';
import { CheckoutThrottlerGuard } from './checkout-throttler.guard';
import { CompanyRegistryService } from './company-registry.service';
import { CompanySessionService } from './company-session.service';
import { ComplementsService } from './complements.service';
import { EvolutionService } from './evolution.service';
import { RegularizationService } from './regularization.service';
import { verifyRepresentative } from './representatives';
import { UnprocessableEntityException } from '@nestjs/common';

/**
 * Contratação em três etapas, evolução de plano, complementos, regularização
 * e sessão da empresa.
 *
 * Convive com as rotas legadas de /subscriptions, que seguem atendendo a
 * tela antiga até a nova substituí-la.
 */
@ApiTags('Contratação')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('subscriptions')
export class CheckoutController {
  constructor(
    private readonly checkoutService: CheckoutService,
    private readonly evolutionService: EvolutionService,
    private readonly complementsService: ComplementsService,
    private readonly regularizationService: RegularizationService,
    private readonly registry: CompanyRegistryService,
    private readonly session: CompanySessionService,
  ) {}

  @Get('checkout/company/:cnpj')
  @UseGuards(CheckoutThrottlerGuard)
  @ApiOperation({
    summary: 'Dados da empresa pelo CNPJ, para a etapa do contrato',
    description:
      'Nunca devolve o quadro societário: só se há administrador contra o qual conferir o representante.',
  })
  async company(@Param('cnpj') cnpj: string) {
    return this.registry.publicView(cnpj);
  }

  @Post('checkout/representative-check')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CheckoutThrottlerGuard)
  @ApiOperation({
    summary: 'Confere o CPF do representante legal contra o quadro societário',
  })
  async representativeCheck(@Body() dto: RepresentativeCheckDto) {
    const record = await this.registry.lookup(dto.cnpj).catch(() => null);
    if (!record) {
      return { registryAvailable: false, verified: false, requiresName: true };
    }
    const verdict = verifyRepresentative(record.partners, dto.cpf);
    if (verdict.status === 'NOT_IN_REGISTRY') {
      throw new UnprocessableEntityException({
        code: 'REPRESENTATIVE_NOT_IN_REGISTRY',
        message:
          'Este CPF não consta como representante legal desta empresa no registro público.',
      });
    }
    if (verdict.status === 'VERIFIED') {
      return {
        registryAvailable: true,
        verified: true,
        requiresName: false,
        representativeName: verdict.name,
        qualification: verdict.qualification,
      };
    }
    return { registryAvailable: true, verified: false, requiresName: true };
  }

  @Post('checkout')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary: 'Contratar: registra a contratação e devolve a fatura para pagar',
  })
  async checkout(@Body() dto: CheckoutDto, @Req() req) {
    return this.checkoutService.checkout(
      this.userOf(req),
      dto,
      this.metaOf(req),
    );
  }

  @Get('contracting/current')
  @ApiOperation({
    summary: 'O que está contratado hoje',
    description:
      'Plano, complementos, próxima mensalidade e contratante em leitura: a base da evolução e da inclusão de complementos.',
  })
  async current(@Req() req) {
    return this.complementsService.current(req.user.companyId);
  }

  @Post('evolution')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary:
      'Evoluir para o próximo plano: registra a evolução e devolve a fatura com o crédito abatido',
  })
  async evolve(@Body() dto: EvolutionDto, @Req() req) {
    return this.evolutionService.evolve(
      this.userOf(req),
      dto,
      this.metaOf(req),
    );
  }

  @Post('complements/quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Quanto a mensalidade passa a ser com os complementos escolhidos',
  })
  async complementsQuote(@Body() dto: ComplementsQuoteDto, @Req() req) {
    return this.complementsService.quote(req.user.companyId, dto);
  }

  @Post('complements')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary:
      'Incluir complementos: liberados na hora, cobrados a partir da próxima mensalidade',
  })
  async complements(@Body() dto: ComplementsDto, @Req() req) {
    return this.complementsService.apply(
      this.userOf(req),
      dto,
      this.metaOf(req),
    );
  }

  @Get('regularization')
  @ApiOperation({ summary: 'Cobrança em aberto a regularizar, se houver' })
  async regularization(@Req() req) {
    return this.regularizationService.view(req.user.companyId);
  }

  @Post('regularization')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary: 'Regularizar: reemite a cobrança em aberto e devolve a fatura',
  })
  async regularize(@Body() dto: RegularizationDto, @Req() req) {
    return this.regularizationService.pay(
      this.userOf(req),
      dto,
      this.metaOf(req),
    );
  }

  @Get('session')
  @ApiOperation({
    summary: 'Sessão da empresa: plano, bloqueio e situação da cobrança',
    description:
      'Para a tela refletir contratação, pagamento e bloqueio sem novo login.',
  })
  async companySession(@Req() req) {
    return this.session.build(req.user.companyId, req.user.userId);
  }

  private userOf(req) {
    return {
      userId: req.user.userId,
      companyId: req.user.companyId,
      isAdmin: !!req.user.isAdmin,
    };
  }

  /** O IP de quem aceitou: o servidor do frontend repassa o do navegador. */
  private metaOf(req): RequestMeta {
    const forwarded = req.headers?.['x-forwarded-for'];
    const forwardedIp = Array.isArray(forwarded)
      ? forwarded[0]
      : typeof forwarded === 'string'
        ? forwarded.split(',')[0].trim()
        : undefined;
    return {
      ip:
        req.headers?.['x-user-ip'] ||
        req.headers?.['x-real-ip'] ||
        forwardedIp ||
        req.ip ||
        null,
      userAgent:
        req.headers?.['x-user-agent'] || req.headers?.['user-agent'] || null,
    };
  }
}
