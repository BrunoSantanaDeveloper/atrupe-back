process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { LocalStrategy } from './local.strategy';
import { AuthService } from '../auth.service';

describe('LocalStrategy', () => {
  let strategy: LocalStrategy;
  let authService: jest.Mocked<Pick<AuthService, 'validateUser'>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocalStrategy,
        {
          provide: AuthService,
          useValue: { validateUser: jest.fn() },
        },
      ],
    }).compile();

    strategy = module.get<LocalStrategy>(LocalStrategy);
    authService = module.get(AuthService);
  });

  it('deve estar definido', () => {
    expect(strategy).toBeDefined();
  });

  it('deve retornar o usuário quando as credenciais são válidas', async () => {
    const user = { id: 'u-1', email: 'user@test.com' };
    (authService.validateUser as jest.Mock).mockResolvedValue(user);

    const result = await strategy.validate('user@test.com', 'senha123');

    expect(result).toEqual(user);
    expect(authService.validateUser).toHaveBeenCalledWith(
      'user@test.com',
      'senha123',
    );
  });

  it('deve lançar UnauthorizedException quando credenciais são inválidas', async () => {
    (authService.validateUser as jest.Mock).mockResolvedValue(null);

    await expect(
      strategy.validate('user@test.com', 'senhaErrada'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('deve lançar UnauthorizedException quando usuário não existe', async () => {
    (authService.validateUser as jest.Mock).mockResolvedValue(null);

    await expect(
      strategy.validate('naoexiste@test.com', 'qualquersenha'),
    ).rejects.toThrow(UnauthorizedException);
  });
});
