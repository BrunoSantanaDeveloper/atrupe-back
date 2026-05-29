import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { AiService } from './ai.service';
import { AiChatRequestDto } from './dto/ai-chat.dto';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
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
}
