import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { UserCrudService } from './user-crud.service';
import { UserPasswordService } from './user-password.service';
import { UserRegistrationService } from './user-registration.service';
import { UserOnboardingService } from './user-onboarding.service';

describe('UserService (Facade)', () => {
  let service: UserService;
  let crud: any;
  let password: any;
  let registration: any;
  let onboarding: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: UserCrudService,
          useValue: {
            findAll: jest.fn(),
            findOne: jest.fn(),
            findOneRoles: jest.fn(),
            findByEmail: jest.fn(),
            check: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: UserPasswordService,
          useValue: {
            forgotPassword: jest.fn(),
            resetPassword: jest.fn(),
            adminPasswordReset: jest.fn(),
            adminGeneratePassword: jest.fn(),
          },
        },
        {
          provide: UserRegistrationService,
          useValue: {
            sendEmailValidation: jest.fn(),
            verifyEmail: jest.fn(),
            createPassword: jest.fn(),
            create: jest.fn(),
            createUserForEmployee: jest.fn(),
          },
        },
        {
          provide: UserOnboardingService,
          useValue: {
            completeRegistration: jest.fn(),
            editClient: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    crud = module.get(UserCrudService) as any;
    password = module.get(UserPasswordService) as any;
    registration = module.get(UserRegistrationService) as any;
    onboarding = module.get(UserOnboardingService) as any;

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // --- Registration delegation ---

  describe('sendEmailValidation', () => {
    it('should delegate to registration service', async () => {
      const expected = { message: 'Email de validação enviado com sucesso.' };
      registration.sendEmailValidation.mockResolvedValue(expected);

      const result = await service.sendEmailValidation(
        'test@test.com',
        'John',
        'Acme',
        '11999',
      );

      expect(result).toEqual(expected);
      expect(registration.sendEmailValidation).toHaveBeenCalledWith(
        'test@test.com',
        'John',
        'Acme',
        '11999',
      );
    });
  });

  describe('verifyEmail', () => {
    it('should delegate to registration service', async () => {
      const expected = { message: 'Email verificado com sucesso.' };
      registration.verifyEmail.mockResolvedValue(expected);

      const body = { email: 'test@test.com', token: '1234' };
      const result = await service.verifyEmail(body);

      expect(result).toEqual(expected);
      expect(registration.verifyEmail).toHaveBeenCalledWith(body);
    });
  });

  describe('createPassword', () => {
    it('should delegate to registration service', async () => {
      const expected = {
        message: 'Usuário criado com sucesso com plano TRIAL.',
      };
      registration.createPassword.mockResolvedValue(expected);

      const dto = {
        email: 'test@test.com',
        password: 'pass',
        name: 'J',
        mobile: '11',
        company: 'C',
      } as any;
      const result = await service.createPassword(dto);

      expect(result).toEqual(expected);
      expect(registration.createPassword).toHaveBeenCalledWith(dto);
    });
  });

  describe('create', () => {
    it('should delegate to registration service', async () => {
      const expected = { message: 'ok' };
      registration.create.mockResolvedValue(expected);

      const dto = { email: 'test@test.com' } as any;
      const result = await service.create(dto);

      expect(result).toEqual(expected);
      expect(registration.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('createUserForEmployee', () => {
    it('should delegate to registration service', async () => {
      registration.createUserForEmployee.mockResolvedValue({ id: 'u-1' });

      const dto = { name: 'J', email: 'j@t.com', password: 'p' } as any;
      const result = await service.createUserForEmployee(
        dto,
        'admin-1',
        'Admin',
      );

      expect(result).toEqual({ id: 'u-1' });
      expect(registration.createUserForEmployee).toHaveBeenCalledWith(
        dto,
        'admin-1',
        'Admin',
      );
    });
  });

  // --- CRUD delegation ---

  describe('findAll', () => {
    it('should delegate to crud service', async () => {
      const users = [{ id: '1', name: 'A', email: 'a@t.com' }];
      crud.findAll.mockResolvedValue(users);

      const result = await service.findAll();

      expect(result).toEqual(users);
      expect(crud.findAll).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should delegate to crud service', async () => {
      const user = {
        id: 'u-1',
        name: 'User',
        email: 'u@t.com',
        avatar: null,
        employee: null,
        policies: [],
      };
      crud.findOne.mockResolvedValue(user);

      const result = await service.findOne('u-1');

      expect(result).toEqual(user);
      expect(crud.findOne).toHaveBeenCalledWith('u-1');
    });
  });

  describe('findOneRoles', () => {
    it('should delegate to crud service', async () => {
      const user = { id: 'u-1', userRole: [] };
      crud.findOneRoles.mockResolvedValue(user);

      const result = await service.findOneRoles('u-1');

      expect(result).toEqual(user);
      expect(crud.findOneRoles).toHaveBeenCalledWith('u-1');
    });
  });

  describe('findByEmail', () => {
    it('should delegate to crud service', async () => {
      const user = { id: 'u-1', email: 'u@t.com' };
      crud.findByEmail.mockResolvedValue(user);

      const result = await service.findByEmail('u@t.com');

      expect(result).toEqual(user);
      expect(crud.findByEmail).toHaveBeenCalledWith('u@t.com');
    });
  });

  describe('check', () => {
    it('should delegate to crud service', async () => {
      crud.check.mockResolvedValue({ name: 'John' });

      const result = await service.check('12345678900');

      expect(crud.check).toHaveBeenCalledWith('12345678900');
      expect(result).toEqual({ name: 'John' });
    });
  });

  describe('update', () => {
    it('should delegate to crud service', async () => {
      crud.update.mockResolvedValue({ id: 'u-1', name: 'Updated' });

      const dto = { name: 'Updated' } as any;
      const result = await service.update('u-1', dto);

      expect(result).toEqual({ id: 'u-1', name: 'Updated' });
      expect(crud.update).toHaveBeenCalledWith('u-1', dto, undefined);
    });
  });

  // --- Password delegation ---

  describe('forgotPassword', () => {
    it('should delegate to password service', async () => {
      password.forgotPassword.mockResolvedValue(undefined);

      await service.forgotPassword({ email: 'u@t.com' } as any);

      expect(password.forgotPassword).toHaveBeenCalledWith({
        email: 'u@t.com',
      });
    });
  });

  describe('resetPassword', () => {
    it('should delegate to password service', async () => {
      password.resetPassword.mockResolvedValue(undefined);

      await service.resetPassword({ token: 'tok', password: 'new' } as any);

      expect(password.resetPassword).toHaveBeenCalledWith({
        token: 'tok',
        password: 'new',
      });
    });
  });

  describe('adminPasswordReset', () => {
    it('should delegate to password service', async () => {
      password.adminPasswordReset.mockResolvedValue(undefined);

      await service.adminPasswordReset('user-1', 'admin-1', 'secret');

      expect(password.adminPasswordReset).toHaveBeenCalledWith(
        'user-1',
        'admin-1',
        'secret',
      );
    });
  });

  describe('adminGeneratePassword', () => {
    it('should delegate to password service', async () => {
      const expected = { temporaryPassword: 'abcdA!12341' };
      password.adminGeneratePassword.mockResolvedValue(expected);

      const result = await service.adminGeneratePassword(
        'user-1',
        'admin-1',
        'secret',
      );

      expect(result).toEqual(expected);
      expect(password.adminGeneratePassword).toHaveBeenCalledWith(
        'user-1',
        'admin-1',
        'secret',
      );
    });
  });

  // --- Onboarding delegation ---

  describe('completeRegistration', () => {
    it('should delegate to onboarding service', async () => {
      const expected = { message: 'Cadastro efetuado com sucesso.' };
      onboarding.completeRegistration.mockResolvedValue(expected);

      const dto = { id: 'reg-1', email: 'c@t.com' } as any;
      const result = await service.completeRegistration(dto, 'admin-1');

      expect(result).toEqual(expected);
      expect(onboarding.completeRegistration).toHaveBeenCalledWith(
        dto,
        'admin-1',
      );
    });
  });

  describe('editClient', () => {
    it('should delegate to onboarding service', async () => {
      const expected = { message: 'Cliente atualizado com sucesso.' };
      onboarding.editClient.mockResolvedValue(expected);

      const dto = { id: 'c-1', email: 'c@t.com' } as any;
      const result = await service.editClient(dto, 'admin-1');

      expect(result).toEqual(expected);
      expect(onboarding.editClient).toHaveBeenCalledWith(dto, 'admin-1');
    });
  });
});
