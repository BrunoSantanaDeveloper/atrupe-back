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
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { UserResponseDto } from './dto/response.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';

@ApiTags('Usuário')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um novo usuário' })
  @ApiBody({
    description: 'Dados do novo usuário',
    type: CreateUserDto,
    examples: {
      example: {
        summary: 'Exemplo de payload para criação de usuário',
        value: {
          name: 'johndoe',
          email: 'johndoe@example.com',
          password: 'securepassword123',
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
  create(@Req() req, @Body() body: CreateUserDto) {
    return this.userService.create(body);
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

  @Patch()
  @UseGuards(JwtAuthGuard)
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
  update() {
    return this.userService.update();
  }

  @Get()
  @UseGuards(JwtAuthGuard)
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
  async findOne(@Param('id') id: string): Promise<UserResponseDto | null> {
    const user = await this.userService.findOne(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }
}
