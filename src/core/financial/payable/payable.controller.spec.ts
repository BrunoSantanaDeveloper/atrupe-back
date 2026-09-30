import { Test, TestingModule } from '@nestjs/testing';
import { PayableController } from './payable.controller';
import { PayableService } from './payable.service';
import { AbacService } from 'src/core/auth/abac/abac.service';
import { PlanControlService } from 'src/core/plan/plan-control.service';
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';

describe('PayableController', () => {
  let controller: PayableController;
  let serviceMock: any;
  let abacMock: any;
  let planControlMock: any;

  beforeEach(async () => {
    serviceMock = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      getHistory: jest.fn(),
      updateTitle: jest.fn(),
      updateInstallments: jest.fn(),
      cancel: jest.fn(),
      undoCancel: jest.fn(),
      payInstallment: jest.fn(),
      compensateInstallment: jest.fn(),
      undoPaymentInstallment: jest.fn(),
      remove: jest.fn(),
    };

    abacMock = {
      hasPermission: jest.fn(),
    };
    planControlMock = {
      enforceFeature: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PayableController],
      providers: [
        { provide: PayableService, useValue: serviceMock },
        { provide: AbacService, useValue: abacMock },
        { provide: PrismaService, useValue: {} },
        { provide: PlanControlService, useValue: planControlMock },
      ],
    }).compile();

    controller = module.get<PayableController>(PayableController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('deve estar definido', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('deve chamar o service.create com os dados corretos', async () => {
      const mockReq = {
        user: { companyId: 'c1', userId: 'u1', name: 'User 1' },
      };
      const dto: any = { description: 'Teste' };

      serviceMock.create.mockResolvedValue({ id: 'p1' });

      const result = await controller.create(mockReq, dto);

      expect(dto.companyId).toBe('c1');
      expect(serviceMock.create).toHaveBeenCalledWith(dto, 'u1', 'User 1');
      expect(result).toEqual({ id: 'p1' });
    });
  });

  describe('upsertInstallments (inline permission check)', () => {
    it('deve permitir acesso se tiver permissão de financial:flow:edit', async () => {
      const mockReq = { user: { userId: 'u1', name: 'User 1' } };
      abacMock.hasPermission.mockImplementation(
        async (user, action, resource) => resource === 'financial:flow',
      );

      serviceMock.updateInstallments.mockResolvedValue({ success: true });

      await controller.upsertInstallments(mockReq, 'p1', {} as any);

      expect(abacMock.hasPermission).toHaveBeenCalledWith(
        mockReq.user,
        'edit',
        'financial:flow',
      );
      expect(serviceMock.updateInstallments).toHaveBeenCalled();
    });

    it('deve permitir acesso se tiver permissão de financial:payable:edit', async () => {
      const mockReq = { user: { userId: 'u1', name: 'User 1' } };
      abacMock.hasPermission.mockImplementation(
        async (user, action, resource) => resource === 'financial:payable',
      );

      serviceMock.updateInstallments.mockResolvedValue({ success: true });

      await controller.upsertInstallments(mockReq, 'p1', {} as any);

      expect(abacMock.hasPermission).toHaveBeenCalledWith(
        mockReq.user,
        'edit',
        'financial:payable',
      );
      expect(serviceMock.updateInstallments).toHaveBeenCalled();
    });

    it('deve lançar ForbiddenException se não tiver nenhuma das permissões', async () => {
      const mockReq = { user: { userId: 'u1' } };
      abacMock.hasPermission.mockResolvedValue(false);

      await expect(
        controller.upsertInstallments(mockReq, 'p1', {} as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('undoCancel (inline permission check)', () => {
    it('deve lançar ForbiddenException se não tiver permissão', async () => {
      const mockReq = { user: { userId: 'u1' } };
      abacMock.hasPermission.mockResolvedValue(false);

      await expect(
        controller.undoCancel(mockReq, 'p1', {} as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve permitir e chamar undoCancel no service se tiver permissão', async () => {
      const mockReq = { user: { userId: 'u1', name: 'User 1' } };
      abacMock.hasPermission.mockResolvedValue(true);
      serviceMock.undoCancel.mockResolvedValue({ id: 'p1' });

      await controller.undoCancel(mockReq, 'p1', {} as any);

      expect(serviceMock.undoCancel).toHaveBeenCalledWith(
        'p1',
        {},
        'u1',
        'User 1',
      );
    });
  });

  describe('updateNotes (inline permission check)', () => {
    it('deve lançar ForbiddenException se não tiver permissão', async () => {
      const mockReq = { user: { userId: 'u1' } };
      abacMock.hasPermission.mockResolvedValue(false);

      await expect(
        controller.updateNotes(mockReq, 'p1', { notes: 'Anotação' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve chamar updateTitle passando notes se tiver permissão', async () => {
      const mockReq = { user: { userId: 'u1', name: 'User 1' } };
      abacMock.hasPermission.mockResolvedValue(true);

      await controller.updateNotes(mockReq, 'p1', { notes: 'Anotação E2E' });

      expect(serviceMock.updateTitle).toHaveBeenCalledWith(
        'p1',
        { notes: 'Anotação E2E' },
        'u1',
        'User 1',
      );
    });
  });
});
