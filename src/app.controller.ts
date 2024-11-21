import { Controller, Get, Logger } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

export interface HealthCheck {
  status: string;
  uptime: string;
}

@Controller()
@ApiTags('App')
export class AppController {
  private readonly logger = new Logger(AppController.name);
  private readonly startTime: number;

  constructor() {
    this.startTime = Date.now();
    this.logger.log('AppController constructor');
  }

  @Get()
  @ApiOperation({ summary: 'Verifica o estado da API' })
  @ApiResponse({
    status: 200,
    description: 'Health check',
  })
  check(): HealthCheck {
    const uptime = (Date.now() - this.startTime) / 1000;
    this.logger.log(`Health check: uptime = ${uptime.toFixed(2)} seconds`);

    return {
      status: 'ok',
      uptime: `${uptime.toFixed(2)} seconds`,
    };
  }
}
