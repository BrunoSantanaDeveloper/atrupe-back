import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';
import { AiModelSelectionService } from './ai-model-selection.service';
import { AiService } from './ai.service';
import { AiChatRequestDto } from './dto/ai-chat.dto';
import { UpdateAiModelConfigDto } from './dto/ai-model-config.dto';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import { AiChatThrottlerGuard } from './guards/ai-chat-throttler.guard';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly modelSelection: AiModelSelectionService,
    private readonly settings: SystemSettingsService,
  ) {}

  @Get('access-status')
  async getAccessStatus() {
    return { enabled: await this.settings.isAiAccessEnabled() };
  }

  @Post('chat')
  @UseGuards(AiChatThrottlerGuard)
  chat(@Body() dto: AiChatRequestDto, @Req() req: Request) {
    return this.aiService.chat(dto, (req as any).user);
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
