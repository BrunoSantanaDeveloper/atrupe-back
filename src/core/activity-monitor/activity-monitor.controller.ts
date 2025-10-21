import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ActivityMonitorService } from './activity-monitor.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

@Controller('activity-monitor')
@UseGuards(JwtAuthGuard)
export class ActivityMonitorController {
  constructor(
    private readonly activityMonitorService: ActivityMonitorService,
  ) {}

  /**
   * GET /activity-monitor/online
   * Retorna usuários atualmente online
   */
  @Get('online')
  async getOnlineUsers(
    @Query('companyId') companyId?: string,
    @Query('minutesThreshold') minutesThreshold?: string,
  ) {
    const threshold = minutesThreshold ? parseInt(minutesThreshold) : 5;
    return this.activityMonitorService.getOnlineUsers(companyId, threshold);
  }

  /**
   * GET /activity-monitor/last-activity/:userId
   * Retorna última atividade de um usuário específico
   */
  @Get('last-activity/:userId')
  async getUserLastActivity(@Param('userId') userId: string) {
    return this.activityMonitorService.getUserLastActivity(userId);
  }

  /**
   * GET /activity-monitor/history/:userId
   * Retorna histórico de atividades de um usuário
   */
  @Get('history/:userId')
  async getUserActivityHistory(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const limitNum = limit ? parseInt(limit) : 50;
    const offsetNum = offset ? parseInt(offset) : 0;
    return this.activityMonitorService.getUserActivityHistory(
      userId,
      limitNum,
      offsetNum,
    );
  }

  /**
   * GET /activity-monitor/statistics/:companyId
   * Retorna estatísticas de uso da empresa
   */
  @Get('statistics/:companyId')
  async getCompanyStatistics(
    @Param('companyId') companyId: string,
    @Query('days') days?: string,
  ) {
    const daysNum = days ? parseInt(days) : 30;
    return this.activityMonitorService.getCompanyStatistics(companyId, daysNum);
  }

  /**
   * POST /activity-monitor/logout
   * Registra logout do usuário
   */
  @Post('logout')
  async logout(@Req() req: any) {
    const sessionId = req.headers['x-session-id'];
    if (sessionId) {
      await this.activityMonitorService.logout(sessionId);
    }
    return { message: 'Logout registrado com sucesso' };
  }
}
