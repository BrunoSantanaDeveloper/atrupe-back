import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local.guard';
import { ApiOperation, ApiResponse, ApiTags, ApiBody } from '@nestjs/swagger';

class LoginDto {
  username: string;
  password: string;
}

@Controller('auth')
@ApiTags('Autenticação')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
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
    return this.authService.login(req.user);
  }
}
