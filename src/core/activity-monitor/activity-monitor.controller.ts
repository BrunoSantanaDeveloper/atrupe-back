import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  UseGuards,
  Req,
  NotFoundException,
} from '@nestjs/common';
import { ActivityMonitorService } from './activity-monitor.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';
import { ListAccessSessionsDto } from './dto/list-access-sessions.dto';

@Controller('activity-monitor')
@UseGuards(JwtAuthGuard)
export class ActivityMonitorController {
  constructor(
    private readonly activityMonitorService: ActivityMonitorService,
  ) {}

  // As rotas de consulta são do superadmin: abertas, qualquer usuário logado
  // lia sessões, IPs e acessos de outras empresas passando o id
  @Get('online')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  async getOnlineUsers(
    @Query('companyId') companyId?: string,
    @Query('minutesThreshold') minutesThreshold?: string,
  ) {
    const threshold = minutesThreshold ? parseInt(minutesThreshold) : 5;
    return this.activityMonitorService.getOnlineUsers(companyId, threshold);
  }

  @Get('access-sessions')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  async listAccessSessions(@Query() query: ListAccessSessionsDto) {
    return this.activityMonitorService.listAccessSessions({
      page: query.page,
      limit: query.limit,
      search: query.search,
      companyId: query.companyId,
      userId: query.userId,
      method: query.method,
      status: query.status,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
    });
  }

  @Get('access-summary')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  async getAccessSummary(
    @Query('companyId') companyId?: string,
    @Query('days') days?: string,
  ) {
    return this.activityMonitorService.getAccessSummary(
      companyId,
      days ? parseInt(days) : 30,
    );
  }

  @Get('sessions/:sessionId')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  async getSessionDetails(
    @Param('sessionId') sessionId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const details = await this.activityMonitorService.getSessionDetails(
      sessionId,
      limit ? parseInt(limit) : 50,
      offset ? parseInt(offset) : 0,
    );
    if (!details) {
      throw new NotFoundException('Sessao nao encontrada');
    }
    return details;
  }

  @Get('last-activity/:userId')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  async getUserLastActivity(@Param('userId') userId: string) {
    return this.activityMonitorService.getUserLastActivity(userId);
  }

  @Get('history/:userId')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
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

  @Get('statistics/:companyId')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  async getCompanyStatistics(
    @Param('companyId') companyId: string,
    @Query('days') days?: string,
  ) {
    const daysNum = days ? parseInt(days) : 30;
    return this.activityMonitorService.getCompanyStatistics(companyId, daysNum);
  }

  @Post('logout')
  async logout(@Req() req: any) {
    const sessionId = req.headers['x-session-id'];
    if (sessionId) {
      await this.activityMonitorService.logout(sessionId);
    }
    return { message: 'Logout registrado com sucesso' };
  }
}
