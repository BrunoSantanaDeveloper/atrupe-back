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

  /**
   * Texto dos termos a partir do .docx — a fonte quando o contrato não tem
   * conteúdo gravado. Tenta os caminhos de desenvolvimento e de build.
   */
  private async loadTermsDocxHtml(): Promise<string> {
    const candidates = [
      path.join(process.cwd(), 'src', 'assets', 'terms.docx'),
      path.join(process.cwd(), 'dist', 'assets', 'terms.docx'),
      path.join(__dirname, '..', '..', 'assets', 'terms.docx'),
      path.join(__dirname, 'assets', 'terms.docx'),
    ];
    for (const filePath of candidates) {
      try {
        const fileBuffer = await fs.promises.readFile(filePath);
        const result = await mammoth.convertToHtml({ buffer: fileBuffer });
        return result.value;
      } catch {
        // tenta o próximo caminho
      }
    }
    return '';
  }

  /**
   * A versão VIGENTE dos termos — a de maior número — com o texto. Fixar na
   * versão 1 fazia a tela oferecer uma versão e o aceite ser registrado
   * contra outra.
   */
  async getCurrentTerms(): Promise<{
    id: string;
    version: number;
    html: string;
  } | null> {
    const contract = await this.prisma.contract.findFirst({
      orderBy: { version: 'desc' },
    });
    if (!contract) return null;
    const html = contract.contentUrl || (await this.loadTermsDocxHtml());
    return { id: contract.id, version: contract.version, html };
  }

  async findContract(res: Response) {
    try {
      const terms = await this.getCurrentTerms();
      const html = terms?.html ?? (await this.loadTermsDocxHtml());

      res.setHeader('Content-Type', 'application/json');
      res.send({
        html,
        contractId: terms?.id,
        version: terms?.version,
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
            userRole: { include: { role: true } },
          },
        });

        // Busca companyId via Employee (link correto entre usuário e empresa)
        const employee = await this.prisma.employee.findFirst({
          where: { userId },
          orderBy: { createdAt: 'asc' },
        });
        const companyId = employee?.companyId;

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

      // O .docx é a única fonte do texto quando o contrato não tem conteúdo
      // gravado — não só na versão 1.
      if (!html) {
        html = await this.loadTermsDocxHtml();
      }

      return {
        html: html || '',
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
