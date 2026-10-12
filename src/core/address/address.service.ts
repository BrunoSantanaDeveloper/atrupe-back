import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

import { PrismaService } from 'nestjs-prisma';
import { Address, OwnerType } from '@prisma/client';
import { assertBelongsToCompany } from 'src/shared/tenant/company-scope';
import { PlugService } from 'src/svc/plug/plug.service';
import { UtilsService } from 'src/svc/utils/utils.service';
import { UpdateAddressDto } from './dto/update-address.dto';

@Injectable()
export class AddressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plugService: PlugService,
    private readonly utilsService: UtilsService,
  ) {}

  async create(address: any, ownerType: OwnerType, ownerId: string) {
    return this.prisma.address.create({
      data: {
        type: address.type,
        zipcode: address.zipcode,
        state: address.state,
        city: address.city,
        neighborhood: address.neighborhood,
        street: address.street,
        number: address.number,
        complement: address.complement,
        ownerType,
        ownerId,
      },
    });
  }

  async findByOwner(ownerId: string, ownerType: OwnerType) {
    return this.prisma.address.findMany({
      where: {
        ownerId,
        ownerType,
      },
      orderBy: {
        type: 'asc',
      },
    });
  }

  async zipCode(zipCode: string) {
    try {
      const data = await this.plugService.zipcode(zipCode);
      return {
        zipcode: data.zipCode,
        street: data.street,
        neighborhood: data.neighborhood,
        city: data.city,
        state: data.state,
      };
    } catch (error) {
      return error;
    }
  }

  async deleteByOwner(ownerId: string, ownerType: OwnerType) {
    return this.prisma.address.deleteMany({
      where: { ownerId, ownerType },
    });
  }

  /** O cliente da rota precisa ser da empresa da sessão */
  async assertClientOfCompany(clientId: string, companyId: string) {
    await assertBelongsToCompany(
      this.prisma.client,
      clientId,
      { companyId },
      'Cliente não encontrado.',
    );
  }

  /**
   * A empresa dona do endereço. O endereço é polimórfico e cada dono grava
   * um campo: a empresa em companyId, o colaborador em employeeId, o
   * fornecedor em supplierId (ou em ownerId) e o cliente e o contato em
   * ownerId.
   */
  private async ownerCompanyOf(address: Address): Promise<string | null> {
    if (address.companyId) return address.companyId;

    const companyOf = async (
      delegate: { findUnique(args: any): Promise<any> },
      id: string,
    ) =>
      (
        await delegate.findUnique({
          where: { id },
          select: { companyId: true },
        })
      )?.companyId ?? null;

    if (address.employeeId) {
      return companyOf(this.prisma.employee, address.employeeId);
    }
    if (address.supplierId) {
      return companyOf(this.prisma.supplier, address.supplierId);
    }
    if (!address.ownerId) return null;

    switch (address.ownerType) {
      case OwnerType.CLIENT:
        return companyOf(this.prisma.client, address.ownerId);
      case OwnerType.SUPPLIER:
        return companyOf(this.prisma.supplier, address.ownerId);
      case OwnerType.EMPLOYEE:
        return companyOf(this.prisma.employee, address.ownerId);
      case OwnerType.COMPANY:
        return address.ownerId;
      case OwnerType.CONTACT: {
        const contact = await this.prisma.contact.findUnique({
          where: { id: address.ownerId },
          select: {
            client: { select: { companyId: true } },
            supplier: { select: { companyId: true } },
          },
        });
        return (
          contact?.client?.companyId ?? contact?.supplier?.companyId ?? null
        );
      }
      default:
        return null;
    }
  }

  /**
   * O endereço de outra empresa responde como inexistente: antes, o id dele
   * alterava ou apagava o endereço do cliente, do fornecedor, do colaborador
   * ou da própria empresa dela.
   */
  private async findOwn(id: string, companyId: string) {
    const address = await this.prisma.address.findUnique({
      where: { id },
    });
    if (!address || (await this.ownerCompanyOf(address)) !== companyId) {
      throw new NotFoundException('Endereço não encontrado.');
    }
    return address;
  }

  async update(id: string, data: UpdateAddressDto, companyId: string) {
    await this.findOwn(id, companyId);
    return this.prisma.address.update({
      where: { id },
      data: {
        type: data.type,
        zipcode: data.zipcode,
        state: data.state,
        city: data.city,
        neighborhood: data.neighborhood,
        street: data.street,
        number: data.number,
        complement: data.complement,
      },
    });
  }

  async delete(id: string, companyId: string) {
    const address = await this.findOwn(id, companyId);

    const count = await this.prisma.address.count({
      where: {
        ownerId: address.ownerId,
        ownerType: address.ownerType,
      },
    });

    if (count <= 1) {
      throw new BadRequestException(
        'Não é possível excluir o único endereço cadastrado.',
      );
    }

    return this.prisma.address.delete({
      where: { id },
    });
  }
}
