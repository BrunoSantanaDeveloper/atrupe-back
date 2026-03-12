import {
  Injectable,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { AcceptContractDto, CreateContractDto } from './dtos';
import { PrismaService } from 'nestjs-prisma';
import * as path from 'path';
import * as fs from 'fs';
import * as mammoth from 'mammoth';
import { Response } from 'express';

@Injectable()
export class ContractService {
  constructor(private readonly prisma: PrismaService) {}

  async findContract(res: Response) {
    try {
      const filePath = path.join(process.cwd(), 'src', 'assets', 'terms.docx');

      const fileBuffer = await fs.promises.readFile(filePath);

      const result = await mammoth.convertToHtml({ buffer: fileBuffer });
      const html = result.value;

      const contract = await this.prisma.contract.findFirst({
        where: {
          version: 1,
        },
      });

      res.setHeader('Content-Type', 'application/json');
      res.send({
        html,
        contractId: contract.id,
      });
    } catch (readError) {
      console.error('Error reading or converting file:', readError);
      throw new NotFoundException('Error processing terms document');
    }
  }

  async acceptContract(acceptContractData: AcceptContractDto) {
    try {
      const { userId, contractId, ipAddress, userAgent } = acceptContractData;

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const contract = await this.prisma.contract.findUnique({
        where: {
          id: contractId,
        },
      });

      if (!contract) {
        throw new NotFoundException('Contract not found');
      }

      const existingAcceptance = await this.prisma.userContract.findUnique({
        where: {
          userId_contractId: {
            userId,
            contractId,
          },
        },
      });

      if (existingAcceptance) {
        return existingAcceptance;
      }

      const userContract = await this.prisma.userContract.create({
        data: {
          userId,
          contractId,
          ipAddress,
          userAgent,
        },
      });

      return userContract;
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException('Error accepting contract');
    }
  }

  async createContract(createContractData: CreateContractDto) {
    const { title, content, version } = createContractData;

    const existingContract = await this.prisma.contract.findFirst({
      where: {
        version,
      },
    });

    if (existingContract) {
      throw new ConflictException(
        'A contract with this version already exists',
      );
    }

    const contract = await this.prisma.contract.create({
      data: {
        name: title,
        contentUrl: content,
        version,
      },
    });

    return contract;
  }

  async getAcceptedContract(userId: string, req?: any) {
    try {
      let userContract = await this.prisma.userContract.findFirst({
        where: { userId },
        orderBy: { acceptedAt: 'desc' },
        include: { contract: true },
      });

      if (!userContract) {
        // JIT Fallback para usuários antigos que já assinaram mas não tem registro de aceite
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          include: {
            customer: true,
            userRole: { include: { role: true } },
          },
        });

        const companyId = user?.customer?.companyId;
        const isAdmin = user?.userRole?.some(
          (ur) => ur.role.name === 'Admin' || ur.isSystemAdmin,
        );

        if (companyId) {
          const activeSubscription = await this.prisma.subscription.findFirst({
            where: {
              companyId: companyId,
              plan: { planType: { not: 'TRIAL' } },
            },
            orderBy: { createdAt: 'desc' },
          });

          if (activeSubscription && isAdmin) {
            const latestContract = await this.prisma.contract.findFirst({
              orderBy: { version: 'desc' },
            });

            if (latestContract) {
              userContract = await this.prisma.userContract.create({
                data: {
                  userId,
                  contractId: latestContract.id,
                  acceptedAt: activeSubscription.createdAt,
                  ipAddress: req?.ip || '0.0.0.0',
                  userAgent: `${req?.headers?.['user-agent'] || 'Unknown'} (JIT Fallback)`,
                },
                include: { contract: true },
              });
            }
          }
        }

        if (!userContract) {
          throw new NotFoundException(
            'No accepted contract found for this user',
          );
        }
      }

      let html = userContract.contract.contentUrl;

      if (!html && userContract.contract.version === 1) {
        const filePath = path.join(
          process.cwd(),
          'src',
          'assets',
          'terms.docx',
        );
        const fileBuffer = await fs.promises.readFile(filePath);
        const result = await mammoth.convertToHtml({ buffer: fileBuffer });
        html = result.value;
      }

      return {
        html,
        contractId: userContract.contractId,
        version: userContract.contract.version,
        acceptedAt: userContract.acceptedAt,
        ipAddress: userContract.ipAddress,
      };
    } catch (error) {
      console.error('Error fetching accepted contract:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error fetching accepted contract',
      );
    }
  }
}
