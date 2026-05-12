import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { ActivityMonitorService } from '../activity-monitor/activity-monitor.service';
import { LocalAuthGuard } from './guards/local.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class LoginDto {
  @ApiProperty({ example: 'user@email.com' })
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(255)
  username: string;

  @ApiProperty({ example: '1234abc@' })
  @IsString()
  @MinLength(4, { message: 'Senha deve ter no mínimo 4 caracteres' })
  @MaxLength(128)
  password: string;
}

@Controller('auth')
@ApiTags('Autenticação')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly activityMonitorService: ActivityMonitorService,
  ) {}

  @Post('login')
  @Throttle({ auth: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Realiza o login do usuário' })
  @ApiBody({
    description: 'Payload para login',
    type: LoginDto,
    examples: {
      example: {
        summary: 'Exemplo de payload',
        value: {
          username: 'teste@email.com',
          password: '1234abc@',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Login realizado com sucesso.',
    schema: {
      example: {
        id: 'uuid-do-usuario',
        name: 'Nome do Usuário',
        email: 'usuario@email.com',
        avatar: 'url-do-avatar',
        role: 'Nome do Cargo',
        employeeId: 'uuid-do-funcionario',
        isAdmin: true,
        permissions: ['client:create', 'client:view', 'product:create'],
        company: {
          id: 'uuid-da-empresa',
          name: 'Nome da Empresa',
          legalName: 'Razão Social da Empresa',
          logo: 'url-da-logo',
          favicon: 'url-do-favicon',
          subscription: 'LITE',
          trialEndsAt: null,
          features: [
            'user_limit_5',
            'additional_cnpj',
            'sectors_management',
            'sales_orders_full',
            'quick_sale',
            'accounts_receivable',
            'accounts_payable',
            'cash_control',
            'pdv',
            'products_full',
            'clients_full',
          ],
        },
        access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9......',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Credenciais inválidas.',
  })
  @UseGuards(LocalAuthGuard)
  async login(@Req() req) {
    const response = await this.authService.login(req.user);
    this.activityMonitorService
      .trackActivity({
        userId: response.id,
        companyId: response.company?.id,
        employeeId: response.employeeId || undefined,
        sessionId: response.sessionId,
        endpoint: '/auth/login',
        method: 'POST',
        ipAddress:
          req.headers['x-forwarded-for'] || req.connection.remoteAddress,
        userAgent: req.headers['user-agent'],
      })
      .catch((error) => {
        console.error('Erro ao rastrear login:', error);
      });
    return response;
  }

  @Post('refresh')
  @Throttle({ auth: { limit: 10, ttl: 60000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Renova o access token usando o refresh token' })
  @ApiResponse({
    status: 201,
    description: 'Token renovado com sucesso.',
    schema: {
      example: {
        access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9......',
        refresh_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9......',
        sessionId: 'uuid-da-sessao',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Refresh token inválido ou expirado.',
  })
  @UseGuards(JwtRefreshGuard)
  async refresh(@Req() req) {
    const response = await this.authService.refreshToken(req.user.userId);
    this.activityMonitorService
      .trackActivity({
        userId: req.user.userId,
        companyId: req.user.companyId,
        employeeId: req.user.employeeId,
        sessionId: response.sessionId,
        endpoint: '/auth/refresh',
        method: 'POST',
        ipAddress:
          req.headers['x-forwarded-for'] || req.connection.remoteAddress,
        userAgent: req.headers['user-agent'],
      })
      .catch((error) => {
        console.error('Erro ao rastrear refresh:', error);
      });
    return response;
  }
}
