import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import {
  BlockLevelGuard,
  RequireUnblocked,
} from '../auth/guards/block-level.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';
import { AiModelSelectionService } from './ai-model-selection.service';
import { AiService } from './ai.service';
import { aiUsageMonth, isAiUsageMonth } from './ai-usage-month';
import { AiChatRequestDto } from './dto/ai-chat.dto';
import {
  AiQuotationDraftRequestDto,
  ApplyAiActionDto,
} from './dto/ai-action.dto';
import { UpdateAiModelConfigDto } from './dto/ai-model-config.dto';
import { AiChatThrottlerGuard } from './guards/ai-chat-throttler.guard';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly modelSelection: AiModelSelectionService,
  ) {}

  // A chave global, o plano (ai_assistant) e a cota do mês da empresa
  @Get('access-status')
  getAccessStatus(@Req() req: Request) {
    return this.aiService.accessStatus((req as any).user);
  }

  // O consumo do assistente por empresa no mês (padrão: o mês atual)
  @Get('usage')
  @UseGuards(SystemAdminGuard)
  getUsage(@Query('month') month?: string) {
    if (month !== undefined && !isAiUsageMonth(month)) {
      throw new BadRequestException('Informe o mês no formato AAAA-MM.');
    }
    return this.aiService.usageByCompany(month ?? aiUsageMonth());
  }

  @Post('chat')
  @UseGuards(AiChatThrottlerGuard)
  chat(@Body() dto: AiChatRequestDto, @Req() req: Request) {
    return this.aiService.chat(dto, (req as any).user);
  }

  // A proposta completa, para o cartão (sem valores para quem não os vê)
  @Get('actions/:id')
  getAction(@Param('id') id: string, @Req() req: Request) {
    return this.aiService.getAction(id, (req as any).user);
  }

  // Aplicar grava pelos serviços das telas: com a empresa bloqueada, não
  @Post('actions/:id/apply')
  @UseGuards(BlockLevelGuard)
  @RequireUnblocked()
  applyAction(
    @Param('id') id: string,
    @Body() dto: ApplyAiActionDto,
    @Req() req: Request,
  ) {
    return this.aiService.applyAction(id, (req as any).user, dto.edited);
  }

  @Post('actions/:id/discard')
  discardAction(@Param('id') id: string, @Req() req: Request) {
    return this.aiService.discardAction(id, (req as any).user);
  }

  // O botão "Montar com IA" do orçamento: o texto do cliente vira proposta
  @Post('quotation-draft')
  @UseGuards(AiChatThrottlerGuard)
  quotationDraft(@Body() dto: AiQuotationDraftRequestDto, @Req() req: Request) {
    return this.aiService.quotationDraft(dto, (req as any).user);
  }

  @Get('conversations')
  listConversations(@Req() req: Request) {
    return this.aiService.listConversations((req as any).user);
  }

  @Get('conversations/:id/messages')
  listMessages(@Param('id') id: string, @Req() req: Request) {
    return this.aiService.listMessages(id, (req as any).user);
  }

  @Delete('conversations/:id')
  deleteConversation(@Param('id') id: string, @Req() req: Request) {
    return this.aiService.deleteConversation(id, (req as any).user);
  }

  @Get('model/config')
  @UseGuards(SystemAdminGuard)
  getModelConfig() {
    return this.modelSelection.getConfig();
  }

  @Put('model/config')
  @UseGuards(SystemAdminGuard)
  updateModelConfig(@Body() dto: UpdateAiModelConfigDto) {
    return this.modelSelection.updateConfig(dto);
  }

  @Get('model/candidates')
  @UseGuards(SystemAdminGuard)
  getModelCandidates() {
    return this.modelSelection.getCandidates();
  }

  @Post('model/evaluate')
  @UseGuards(SystemAdminGuard)
  evaluateModels() {
    return this.modelSelection.evaluateAndMaybeSwitch('manual');
  }
}
