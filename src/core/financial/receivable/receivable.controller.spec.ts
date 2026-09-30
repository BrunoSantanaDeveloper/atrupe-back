import { Test, TestingModule } from '@nestjs/testing';
import { ReceivableController } from './receivable.controller';
import { ReceivableService } from './receivable.service';
import { AbacService } from 'src/core/auth/abac/abac.service';
import { PlanControlService } from 'src/core/plan/plan-control.service';
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';

describe('ReceivableController', () => {
  let controller: ReceivableController;
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
      getReceiptData: jest.fn(),
    };

    abacMock = {
      hasPermission: jest.fn(),
    };
    planControlMock = {
      enforceFeature: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReceivableController],
      providers: [
        { provide: ReceivableService, useValue: serviceMock },
        { provide: AbacService, useValue: abacMock },
        { provide: PrismaService, useValue: {} },
        { provide: PlanControlService, useValue: planControlMock },
      ],
    }).compile();

    controller = module.get<ReceivableController>(ReceivableController);
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
      const dto: any = { description: 'Receita Teste' };

      serviceMock.create.mockResolvedValue({ id: 'r1' });

      const result = await controller.create(mockReq, dto);

      expect(dto.companyId).toBe('c1');
      expect(serviceMock.create).toHaveBeenCalledWith(dto, 'u1', 'User 1');
      expect(result).toEqual({ id: 'r1' });
    });
  });

  describe('upsertInstallments (inline permission check)', () => {
    it('deve permitir acesso se tiver permissão de financial:flow:edit', async () => {
      const mockReq = { user: { userId: 'u1', name: 'User 1' } };
      abacMock.hasPermission.mockImplementation(
        async (_user, _action, resource) => resource === 'financial:flow',
      );
      serviceMock.updateInstallments.mockResolvedValue({ success: true });

      await controller.upsertInstallments(mockReq, 'r1', {} as any);

      expect(abacMock.hasPermission).toHaveBeenCalledWith(
        mockReq.user,
        'edit',
        'financial:flow',
      );
      expect(serviceMock.updateInstallments).toHaveBeenCalled();
    });

    it('deve permitir acesso se tiver permissão de financial:receivable:edit', async () => {
      const mockReq = { user: { userId: 'u1', name: 'User 1' } };
      abacMock.hasPermission.mockImplementation(
        async (_user, _action, resource) => resource === 'financial:receivable',
      );
      serviceMock.updateInstallments.mockResolvedValue({ success: true });

      await controller.upsertInstallments(mockReq, 'r1', {} as any);

      expect(abacMock.hasPermission).toHaveBeenCalledWith(
        mockReq.user,
        'edit',
        'financial:receivable',
      );
      expect(serviceMock.updateInstallments).toHaveBeenCalled();
    });

    it('deve lançar ForbiddenException se não tiver nenhuma das permissões', async () => {
      const mockReq = { user: { userId: 'u1' } };
      abacMock.hasPermission.mockResolvedValue(false);

      await expect(
        controller.upsertInstallments(mockReq, 'r1', {} as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('undoCancel (inline permission check)', () => {
    it('deve lançar ForbiddenException se não tiver permissão', async () => {
      const mockReq = { user: { userId: 'u1' } };
      abacMock.hasPermission.mockResolvedValue(false);

      await expect(
        controller.undoCancel(mockReq, 'r1', {} as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve permitir e chamar undoCancel no service se tiver permissão', async () => {
      const mockReq = { user: { userId: 'u1', name: 'User 1' } };
      abacMock.hasPermission.mockResolvedValue(true);
      serviceMock.undoCancel.mockResolvedValue({ id: 'r1' });

      await controller.undoCancel(mockReq, 'r1', {} as any);

      expect(serviceMock.undoCancel).toHaveBeenCalledWith(
        'r1',
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
        controller.updateNotes(mockReq, 'r1', { notes: 'Anotação' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve chamar updateTitle passando notes se tiver permissão', async () => {
      const mockReq = { user: { userId: 'u1', name: 'User 1' } };
      abacMock.hasPermission.mockResolvedValue(true);

      await controller.updateNotes(mockReq, 'r1', { notes: 'Anotação E2E' });

      expect(serviceMock.updateTitle).toHaveBeenCalledWith(
        'r1',
        { notes: 'Anotação E2E' },
        'u1',
        'User 1',
      );
    });
  });

  describe('getReceiptData', () => {
    it('deve chamar getReceiptData no service com os parâmetros corretos', async () => {
      serviceMock.getReceiptData.mockResolvedValue({ amount: 100 });
      const mockReq = { user: { userId: 'u1' } };

      const result = await controller.getReceiptData(
        mockReq,
        'inst-1',
        '2024-01-01',
        '150',
      );

      expect(serviceMock.getReceiptData).toHaveBeenCalledWith(
        'inst-1',
        '2024-01-01',
        '150',
        mockReq.user.userId,
      );
      expect(result).toEqual({ amount: 100 });
    });
  });
});
