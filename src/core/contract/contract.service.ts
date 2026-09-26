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

/** CPF de terceiro na tela: só os dígitos do meio, como no registro público. */
function maskCpf(cpf: string | null): string | null {
  const digits = (cpf ?? '').replace(/\D/g, '');
  if (digits.length !== 11) return null;
  return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
}

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
    name: string;
    version: number;
    html: string;
  } | null> {
    const contract = await this.prisma.contract.findFirst({
      orderBy: { version: 'desc' },
    });
    if (!contract) return null;
    const html = contract.contentUrl || (await this.loadTermsDocxHtml());
    return {
      id: contract.id,
      name: contract.name,
      version: contract.version,
      html,
    };
  }

  async findContract(res: Response) {
    try {
      const terms = await this.getCurrentTerms();
      const html = terms?.html ?? (await this.loadTermsDocxHtml());

      res.setHeader('Content-Type', 'application/json');
      res.send({
        html,
        contractId: terms?.id,
        name: terms?.name,
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

  /**
   * O contrato que rege a assinatura da empresa: o aceite mais recente, com o
   * texto da versão aceita e as partes. É da empresa, não de quem aceitou —
   * qualquer pessoa que vê a assinatura vê o contrato dela.
   */
  async getCompanyAcceptance(companyId: string) {
    const acceptance = await this.prisma.contractAcceptance.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: { contract: true },
    });
    if (!acceptance) return null;

    const html =
      acceptance.contract.contentUrl || (await this.loadTermsDocxHtml());
    return {
      html,
      contractId: acceptance.contractId,
      name: acceptance.contract.name,
      version: acceptance.contractVersion,
      acceptedAt: acceptance.createdAt,
      ipAddress: acceptance.ipAddress,
      acceptedBy: {
        name: acceptance.acceptedByName,
        email: acceptance.acceptedByEmail,
      },
      contractor: {
        type: acceptance.contractorType,
        document: acceptance.contractorDocument,
        name: acceptance.contractorName,
        tradeName: acceptance.contractorTradeName,
        email: acceptance.contractorEmail,
      },
      representative: acceptance.representativeName
        ? {
            name: acceptance.representativeName,
            cpf: maskCpf(acceptance.representativeCpf),
            verified: acceptance.representativeVerified,
          }
        : null,
      principalAdmin: acceptance.principalAdminName
        ? {
            name: acceptance.principalAdminName,
            email: acceptance.principalAdminEmail,
          }
        : null,
    };
  }

  async getAcceptedContract(userId: string, req?: any) {
    const companyId: string | undefined = req?.user?.companyId;
    if (companyId) {
      const acceptance = await this.getCompanyAcceptance(companyId);
      if (acceptance) return acceptance;
    }

    // Assinaturas anteriores ao aceite com as partes: o registro por usuário.
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
            // A versão vigente quando a assinatura foi feita, não a de hoje:
            // quem contratou antes de uma versão nova não a aceitou.
            const contractAtTheTime =
              (await this.prisma.contract.findFirst({
                where: { createdAt: { lte: activeSubscription.createdAt } },
                orderBy: { version: 'desc' },
              })) ??
              (await this.prisma.contract.findFirst({
                orderBy: { version: 'asc' },
              }));

            if (contractAtTheTime) {
              userContract = await this.prisma.userContract.create({
                data: {
                  userId,
                  contractId: contractAtTheTime.id,
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
        name: userContract.contract.name,
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
