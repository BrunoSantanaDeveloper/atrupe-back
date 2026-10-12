import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PublicThrottlerGuard } from './guards/public-throttler.guard';
import { UserService } from './user.service';
import {
  CreateMailVerificationDto,
  CreateUserByEmployeeDto,
  CreateUserDto,
} from './dto/create.dto';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { EditClientDto } from './dto/edit-client.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';
import { UserResponseDto } from './dto/response.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UpdateUserDto } from './dto/update-user.dto';
import { PlanControlService } from '../plan/plan-control.service';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import { HasPermission } from '../auth/abac/has-permission.decorator';
import { HasAnyPermission } from '../auth/abac/has-any-permission.decorator';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { AdminPasswordResetDto } from './dto/admin-password-reset.dto';

@ApiTags('Usuário')
@Controller('user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly planControl: PlanControlService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('teste')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  @HasPermission('view', 'register:client')
  testPermission() {
    return 'YOU HAVE PERMISSION';
  }

  @Post()
  @UseGuards(PublicThrottlerGuard)
  @Throttle({ public: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Cria um novo usuário' })
  @ApiBody({
    description: 'Dados do novo usuário',
    type: CreateUserDto,
    examples: {
      example: {
        summary: 'Exemplo de payload para criação de usuário',
        value: {
          email: 'johndoe@example.com',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Usuário criado com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'Dados inválidos.',
  })
  async create(@Req() req, @Body() body: CreateMailVerificationDto) {
    return await this.userService.create(body);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('employee')
  @ApiOperation({ summary: 'Cria um novo usário a partir de um funcionário' })
  @ApiResponse({
    status: 201,
    description: 'Funcionário criado com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'Dados inválidos.',
  })
  async createEmployee(@Req() req, @Body() body: CreateUserByEmployeeDto) {
    body.company = req.user.companyId;
    // Dar acesso a mais uma pessoa respeita o limite de usuários do plano
    // (mais os usuários adicionais contratados).
    await this.planControl.enforceUserLimit(req.user.companyId);
    return await this.userService.createUserForEmployee(
      body,
      req.user?.userId,
      undefined, // userName será buscado do relacionamento com user
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Obtém os dados do usuário autenticado' })
  @ApiResponse({
    status: 200,
    description: 'Dados do usuário retornados com sucesso.',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Usuário não encontrado.',
  })
  async me(@Req() req): Promise<UserResponseDto | null> {
    const user = await this.userService.findOne(req.user.userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('check/:doc')
  @ApiOperation({
    summary: 'Verifica os dados de um usuário pelo documento fornecido',
  })
  @ApiParam({
    name: 'doc',
    required: true,
    description: 'Documento do usuário',
  })
  @ApiResponse({
    status: 200,
    description: 'Retorna os dados do usuário encontrado.',
  })
  @ApiResponse({
    status: 404,
    description: 'Usuário não encontrado.',
  })
  async check(@Param('doc') doc: string): Promise<any | null> {
    const user = await this.userService.check(doc);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  @Patch('edit-client')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Edita um cliente já cadastrado (apenas SystemAdmin)',
  })
  @ApiBody({
    description: 'Dados atualizados do cliente',
    type: EditClientDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Cliente atualizado com sucesso.',
  })
  @ApiResponse({
    status: 401,
    description: 'Senha do administrador incorreta.',
  })
  @ApiResponse({
    status: 403,
    description: 'Acesso negado. Apenas administradores do sistema.',
  })
  @ApiResponse({
    status: 404,
    description: 'Empresa não encontrada.',
  })
  @ApiResponse({
    status: 409,
    description: 'E-mail ou CNPJ já cadastrado.',
  })
  async editClient(@Req() req, @Body() editClientDto: EditClientDto) {
    return await this.userService.editClient(editClientDto, req.user.userId);
  }

  @Post(':id/admin-password-reset')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'id', required: true, description: 'ID do usuario' })
  @ApiOperation({
    summary: 'Envia redefinicao de senha para um usuario (apenas SystemAdmin)',
  })
  @ApiBody({
    description: 'Senha gerencial do administrador',
    type: AdminPasswordResetDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Email de redefinicao de senha enviado com sucesso.',
  })
  @ApiResponse({
    status: 401,
    description: 'Senha do administrador incorreta.',
  })
  @ApiResponse({
    status: 403,
    description: 'Acesso negado. Apenas administradores do sistema.',
  })
  @ApiResponse({
    status: 404,
    description: 'Usuario nao encontrado.',
  })
  async adminPasswordReset(
    @Param('id') id: string,
    @Req() req,
    @Body() adminPasswordResetDto: AdminPasswordResetDto,
  ): Promise<{ message: string }> {
    await this.userService.adminPasswordReset(
      id,
      req.user.userId,
      adminPasswordResetDto.password,
    );

    return { message: 'Email de redefinicao de senha enviado com sucesso.' };
  }

  @Post(':id/admin-generate-password')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'id', required: true, description: 'ID do usuario' })
  @ApiOperation({
    summary: 'Gera senha temporaria para um usuario (apenas SystemAdmin)',
  })
  @ApiBody({
    description: 'Senha gerencial do administrador',
    type: AdminPasswordResetDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Senha temporaria gerada com sucesso.',
  })
  @ApiResponse({
    status: 401,
    description: 'Senha do administrador incorreta.',
  })
  @ApiResponse({
    status: 403,
    description: 'Acesso negado. Apenas administradores do sistema.',
  })
  @ApiResponse({
    status: 404,
    description: 'Usuario nao encontrado.',
  })
  async adminGeneratePassword(
    @Param('id') id: string,
    @Req() req,
    @Body() adminPasswordResetDto: AdminPasswordResetDto,
  ): Promise<{ temporaryPassword: string }> {
    return await this.userService.adminGeneratePassword(
      id,
      req.user.userId,
      adminPasswordResetDto.password,
    );
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @HasAnyPermission(
    { action: 'edit', resource: 'company_settings:users' },
    { action: 'delete', resource: 'company_settings:users' },
  )
  @ApiParam({ name: 'id', required: true, description: 'ID do usuário' })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Atualiza os dados do usuário' })
  @ApiResponse({
    status: 200,
    description: 'Dados do usuário atualizados com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'Dados inválidos.',
  })
  async update(
    @Param('id') id: string,
    @Req() req,
    @Body() body: UpdateUserDto,
  ) {
    // Reativar um usuário também conta no limite de usuários do plano.
    if (body.isActive === true && req.user?.companyId) {
      const target = await this.prisma.user.findUnique({
        where: { id },
        select: { isActive: true },
      });
      if (target && !target.isActive) {
        await this.planControl.enforceUserLimit(req.user.companyId, id);
      }
    }
    return this.userService.update(id, body, req.user);
  }

  // Todos os usuários do sistema, com e-mail: só o superadmin
  @Get()
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtém a lista de todos os usuários' })
  @ApiResponse({
    status: 200,
    description: 'Lista de usuários retornada com sucesso.',
    isArray: true,
    type: UserResponseDto,
  })
  findAll() {
    return this.userService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtém um usuário pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do usuário' })
  @ApiResponse({
    status: 200,
    description: 'Dados do usuário retornados com sucesso.',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Usuário não encontrado.',
  })
  async findOne(
    @Param('id') id: string,
    @Req() req,
  ): Promise<UserResponseDto | null> {
    // O próprio usuário, o superadmin ou alguém da mesma empresa
    const user = await this.userService.findOneForActor(id, req.user);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  @Post('forgot-password')
  @UseGuards(PublicThrottlerGuard)
  @Throttle({ public: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Solicita redefinição de senha' })
  @ApiBody({
    description: 'Email do usuário',
    type: ForgotPasswordDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Email de redefinição de senha enviado com sucesso.',
  })
  async forgotPassword(
    @Body() forgotPasswordDto: ForgotPasswordDto,
  ): Promise<void> {
    await this.userService.forgotPassword(forgotPasswordDto);
  }

  @Post('reset-password')
  @UseGuards(PublicThrottlerGuard)
  @Throttle({ public: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Redefine a senha do usuário' })
  @ApiBody({
    description: 'Token e nova senha',
    type: ResetPasswordDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Senha redefinida com sucesso.',
  })
  @ApiResponse({
    status: 401,
    description: 'Token inválido ou expirado.',
  })
  async resetPassword(
    @Body() resetPasswordDto: ResetPasswordDto,
  ): Promise<void> {
    await this.userService.resetPassword(resetPasswordDto);
  }

  @Post('verify-email')
  @UseGuards(PublicThrottlerGuard)
  @Throttle({ public: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Verifica o email do usuário' })
  @ApiBody({
    description: 'Email e token de verificação',
    type: VerifyEmailDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Email verificado com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'Token inválido ou expirado.',
  })
  async verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return await this.userService.verifyEmail(verifyEmailDto);
  }

  @Post('resend-verification')
  @UseGuards(PublicThrottlerGuard)
  @Throttle({ public: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Reenvia o email de verificação' })
  @ApiBody({
    description: 'Email do usuário',
    schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email do usuário',
          example: 'usuario@exemplo.com',
        },
      },
      required: ['email'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Email de verificação reenviado com sucesso.',
  })
  async resendVerification(@Body('email') email: string) {
    return await this.userService.sendEmailValidation(email);
  }

  @Post('create-password')
  @UseGuards(PublicThrottlerGuard)
  @Throttle({ public: { limit: 3, ttl: 60000 } })
  @ApiOperation({
    summary: 'Cria uma senha para o usuário após verificação de email',
  })
  @ApiBody({
    description: 'Nova senha do usuário',
    type: CreateUserDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Senha criada com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'Usuário não encontrado ou email não verificado.',
  })
  async createPassword(@Body() createUserDto: CreateUserDto) {
    const result = await this.userService.createPassword(createUserDto);
    return { message: 'Senha criada com sucesso.', eventId: result.eventId };
  }

  @Post('complete-registration')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Efetiva o cadastro de um cliente a partir de um cadastro incompleto (apenas SystemAdmin)',
  })
  @ApiBody({
    description: 'Dados completos para efetivar o cadastro',
    type: CompleteRegistrationDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Cadastro efetuado com sucesso.',
  })
  @ApiResponse({
    status: 401,
    description: 'Senha do administrador incorreta.',
  })
  @ApiResponse({
    status: 403,
    description: 'Acesso negado. Apenas administradores do sistema.',
  })
  @ApiResponse({
    status: 404,
    description: 'Cadastro incompleto não encontrado.',
  })
  async completeRegistration(
    @Req() req,
    @Body() completeRegistrationDto: CompleteRegistrationDto,
  ) {
    return await this.userService.completeRegistration(
      completeRegistrationDto,
      req.user.userId,
    );
  }
}
