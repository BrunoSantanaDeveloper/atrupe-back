import { ApiProperty } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty({
    description: 'ID do usuário',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Nome do usuário',
    example: 'John Doe',
  })
  name: string;

  @ApiProperty({
    description: 'Email do usuário',
    example: 'johndoe@example.com',
  })
  email: string;

  @ApiProperty({
    description: 'Dados do empregado do usuário',
    example: {
      company: {
        id: '456e7890-e12d-34a6-b789-567890123456',
        name: 'Tech Innovators Ltda',
      },
      role: 'Developer',
    },
  })
  employee: {
    company: any;
    role: string;
    isAdmin: boolean;
  };

  @ApiProperty({
    description: 'Avatar do usuário',
    example: 'https://example.com/avatar.jpg',
    required: false,
  })
  avatar?: string;

  @ApiProperty({
    description: 'Políticas associadas ao usuário',
    isArray: true,
    required: false,
    example: [
      {
        id: '1',
        name: 'Policy 1',
        description: 'Description of Policy 1',
      },
      {
        id: '2',
        name: 'Policy 2',
        description: 'Description of Policy 2',
      },
    ],
  })
  policies?: string[];

  @ApiProperty({
    description: 'Roles diretos do usuário (UserRole)',
    isArray: true,
    required: false,
    example: [
      {
        isSystemAdmin: true,
        role: {
          permissions: ['*'],
          isAdmin: true,
        },
      },
    ],
  })
  userRole?: {
    isSystemAdmin: boolean;
    role: {
      permissions: string[];
      isAdmin: boolean;
    };
  }[];
}
