import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { PrismaService } from 'src/config/prisma/prisma.service';

describe('ProfileService', () => {
  let service: ProfileService;
  let prisma: {
    sellerProfile: Record<string, jest.Mock>;
    employee: Record<string, jest.Mock>;
  };

  beforeEach(async () => {
    prisma = {
      sellerProfile: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      employee: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<ProfileService>(ProfileService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('isolamento por empresa', () => {
    // O findFirst com { id, companyId } não acha o perfil de outra empresa
    const outraEmpresa = () =>
      prisma.sellerProfile.findFirst.mockResolvedValue(null);
    const daEmpresa = () =>
      prisma.sellerProfile.findFirst.mockResolvedValue({
        id: 'p-1',
        companyId: 'c-1',
      });

    it('findOne procura pelo id e pela empresa da sessão', async () => {
      daEmpresa();
      await expect(service.findOne('p-1', 'c-1')).resolves.toEqual({
        id: 'p-1',
        companyId: 'c-1',
      });
      expect(prisma.sellerProfile.findFirst).toHaveBeenCalledWith({
        where: { id: 'p-1', companyId: 'c-1' },
      });
    });

    it('findOne responde 404 ao perfil de outra empresa', async () => {
      outraEmpresa();
      await expect(service.findOne('p-9', 'c-1')).rejects.toThrow(
        new NotFoundException('Perfil de vendedor não encontrado.'),
      );
    });

    it('update não altera o perfil de outra empresa', async () => {
      outraEmpresa();
      await expect(
        service.update('p-9', 'c-1', { commission: 50, maxDiscount: 100 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.sellerProfile.update).not.toHaveBeenCalled();
    });

    it('update altera o perfil da empresa', async () => {
      daEmpresa();
      prisma.sellerProfile.update.mockResolvedValue({ id: 'p-1' });
      await service.update('p-1', 'c-1', { commission: 5 });
      expect(prisma.sellerProfile.update).toHaveBeenCalledWith({
        where: { id: 'p-1' },
        data: { commission: 5 },
      });
    });

    it('remove não toca o perfil de outra empresa nem os vendedores dele', async () => {
      outraEmpresa();
      await expect(service.remove('p-9', 'c-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.employee.updateMany).not.toHaveBeenCalled();
      expect(prisma.sellerProfile.update).not.toHaveBeenCalled();
    });

    it('remove desvincula só os vendedores da empresa e inativa o perfil', async () => {
      daEmpresa();
      await service.remove('p-1', 'c-1');
      expect(prisma.employee.updateMany).toHaveBeenCalledWith({
        where: { sellerProfileId: 'p-1', companyId: 'c-1' },
        data: { sellerProfileId: null },
      });
      expect(prisma.sellerProfile.update).toHaveBeenCalledWith({
        where: { id: 'p-1' },
        data: { isActive: false },
      });
    });

    it('removeEmployee não mexe no colaborador de outra empresa', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);
      await expect(service.removeEmployee('e-9', 'c-1')).rejects.toThrow(
        new NotFoundException('Colaborador não encontrado.'),
      );
      expect(prisma.employee.findFirst).toHaveBeenCalledWith({
        where: { id: 'e-9', companyId: 'c-1' },
        select: { id: true },
      });
      expect(prisma.employee.update).not.toHaveBeenCalled();
    });

    it('removeEmployee desvincula o colaborador da empresa', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'e-1' });
      await service.removeEmployee('e-1', 'c-1');
      expect(prisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'e-1' },
        data: { sellerProfileId: null },
      });
    });

    it('addEmployee recusa perfil de outra empresa ou inativo', async () => {
      outraEmpresa();
      await expect(
        service.addEmployee('p-9', 'c-1', { employeeId: 'e-1' }),
      ).rejects.toThrow(
        new NotFoundException('Perfil de vendedor não encontrado.'),
      );
      expect(prisma.sellerProfile.findFirst).toHaveBeenCalledWith({
        where: { id: 'p-9', companyId: 'c-1', isActive: true },
        select: { id: true },
      });
      expect(prisma.employee.update).not.toHaveBeenCalled();
    });

    it('addEmployee recusa colaborador de outra empresa', async () => {
      daEmpresa();
      prisma.employee.findFirst.mockResolvedValue(null);
      await expect(
        service.addEmployee('p-1', 'c-1', { employeeId: 'e-9' }),
      ).rejects.toThrow(new NotFoundException('Colaborador não encontrado.'));
      expect(prisma.employee.update).not.toHaveBeenCalled();
    });

    it('addEmployee vincula o colaborador ao perfil, os dois da empresa', async () => {
      daEmpresa();
      prisma.employee.findFirst.mockResolvedValue({ id: 'e-1' });
      await service.addEmployee('p-1', 'c-1', { employeeId: 'e-1' });
      expect(prisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'e-1' },
        data: { sellerProfileId: 'p-1' },
      });
    });
  });
});
