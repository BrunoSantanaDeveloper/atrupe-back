import {
  Injectable,
  NotFoundException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  Optional,
} from '@nestjs/common';
import { ComposedItemService } from './composed-item.service';
import { PrismaService } from 'nestjs-prisma';
import { Prisma, Quotation, QuotationStatus } from '@prisma/client';
import { add, endOfDay } from 'date-fns';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import {
  DuplicateQuotationDto,
  DuplicateQuotationProductDto,
  DuplicateQuotationProductItemDto,
} from './dto/duplicate-quotation.dto';
import { FilterQuotationDto } from './dto/filter.dto';
import { QUOTATION_FIND_ONE_INCLUDE } from './quotation.includes';
import { transformQuotationToResponse } from './quotation.transformers';
import { basePriceContext } from './item-base-price';
import { PlanControlService } from '../../plan/plan-control.service';
import { QuotationGroup } from './quotation.service';
import { reassignQuotationSeries } from './quotation-series.util';
import { copyItemLines } from './quotation-lines.service';
import { itemValue } from './quotation-totals';
import { assertBelongsToCompany } from 'src/shared/tenant/company-scope';
import { followDeliveryInTx } from '../../production/production-follow';
import {
  dueWhere,
  expiringWhere,
  noContactWhere,
} from './follow-up/follow-up.service';

const EXPORT_LIMIT = '10000';

/**
 * QuotationCrudService
 * Responsável por operações CRUD básicas do orçamento.
 */
@Injectable()
export class QuotationCrudService {
  private readonly logger = new Logger(QuotationCrudService.name);

  constructor(
    private prisma: PrismaService,
    // Copia o rascunho do item montado ao duplicar (ORC-11)
    @Optional() private composed?: ComposedItemService,
    // As faixas de quantidade do preço base valem com o recurso do plano
    @Optional() private planControl?: PlanControlService,
  ) {}

  /**
   * Método auxiliar para buscar userId a partir de employeeId
   */
  async getUserIdFromEmployee(
    employeeId: string,
  ): Promise<{ userId: string; userName: string } | null> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        userId: true,
        name: true,
        user: { select: { name: true } },
      },
    });

    if (!employee?.userId) {
      return null;
    }

    return {
      userId: employee.userId,
      userName: employee.name || employee.user?.name || 'Usuário',
    };
  }

  /**
   * As empresas da conta da sessão: a principal e as filiais dela, as que
   * o formulário oferece como empresa do orçamento.
   */
  private async accountCompanies(sessionCompanyId: string) {
    return this.prisma.company.findMany({
      where: {
        OR: [
          { id: sessionCompanyId },
          { principalCompanyId: sessionCompanyId },
        ],
      },
      select: { id: true, principalCompanyId: true },
    });
  }

  /**
   * A empresa do corpo é a emissora e precisa ser da conta. Volta o par
   * gravado no orçamento: a principal em companyId e a emissora em
   * subCompanyId.
   */
  private async emitterOfAccount(companyId: string, sessionCompanyId: string) {
    const companies = await this.accountCompanies(sessionCompanyId);
    const emitter = companies.find((company) => company.id === companyId);
    if (!emitter) {
      throw new NotFoundException('Empresa não encontrada.');
    }
    return {
      companyIds: companies.map((company) => company.id),
      companyId: emitter.principalCompanyId ?? emitter.id,
      subCompanyId: emitter.id,
    };
  }

  /**
   * Cliente, vendedor, origem de contato, status e série do corpo
   * precisam ser da conta (a origem pode ser global, sem empresa).
   */
  private async assertRefsOfAccount(
    companyIds: string[],
    refs: {
      clientId?: string | null;
      sellerId?: string | null;
      contactSourceId?: string | null;
      tagId?: string | null;
      seriesId?: string | null;
    },
  ) {
    const scope = { companyId: { in: companyIds } };
    await assertBelongsToCompany(
      this.prisma.client,
      refs.clientId,
      scope,
      'Cliente não encontrado.',
    );
    await assertBelongsToCompany(
      this.prisma.employee,
      refs.sellerId,
      scope,
      'Vendedor não encontrado.',
    );
    await assertBelongsToCompany(
      this.prisma.contactSource,
      refs.contactSourceId,
      { OR: [scope, { companyId: null }] },
      'Origem de contato não encontrada.',
    );
    await assertBelongsToCompany(
      this.prisma.quotationTag,
      refs.tagId,
      scope,
      'Status não encontrado.',
    );
    await assertBelongsToCompany(
      this.prisma.saleSeries,
      refs.seriesId,
      scope,
      'Série não encontrada.',
    );
  }

  /**
   * Cria um novo orçamento
   */
  async create(
    createQuotationDto: CreateQuotationDto,
    userId: string | undefined,
    sessionCompanyId: string,
  ): Promise<Quotation> {
    const {
      description,
      contactSourceId,
      companyId,
      sellerId,
      clientId,
      contactId,
      seriesId,
    } = createQuotationDto;

    try {
      if (!seriesId) {
        throw new BadRequestException(
          `Não é possível criar um orçamento sem uma série`,
        );
      }
      // Empresa, série e cadastros do corpo precisam ser da conta da
      // sessão: antes, o id de outra empresa criava o orçamento nela e
      // consumia um número da série dela
      const account = await this.emitterOfAccount(companyId, sessionCompanyId);
      await this.assertRefsOfAccount(account.companyIds, {
        clientId,
        sellerId,
        contactSourceId,
        seriesId,
      });
      const series = await this.prisma.saleSeries.findUnique({
        where: { id: seriesId },
      });
      if (!series) {
        throw new NotFoundException(`Serie não encontrada`);
      }
      const mainCompany = await this.prisma.company.findUnique({
        where: { id: companyId },
        select: {
          id: true,
          principalCompanyId: true,
        },
      });

      // O responsável precisa ser do cliente informado, como na edição.
      // Sem cliente no corpo, o contato de outra empresa era gravado sem
      // conferência nenhuma
      if (contactId) {
        if (!clientId) {
          throw new BadRequestException(
            'Informe um cliente para vincular o responsável.',
          );
        }
        const contact = await this.prisma.contact.findFirst({
          where: {
            id: contactId,
            clientId: clientId,
          },
        });
        if (!contact) {
          throw new BadRequestException(
            `Contato não encontrado ou não pertence ao cliente informado`,
          );
        }
      }

      // Atomic increment: increment first, then use the returned value
      const updatedSeries = await this.prisma.saleSeries.update({
        where: { id: seriesId },
        data: { currentBudgetNumber: { increment: 1 } },
        select: { currentBudgetNumber: true },
      });

      const newQuotation = await this.prisma.quotation.create({
        data: {
          description,
          contactSourceId,
          companyId: mainCompany.principalCompanyId
            ? mainCompany.principalCompanyId
            : mainCompany.id,
          subCompanyId: mainCompany.id,
          sellerId,
          clientId,
          contactId,
          seriesId: seriesId || undefined,
          // Venda rápida: orçamento que pode não ter cliente. O controller já
          // conferiu que o plano inclui o recurso.
          quickSale: createQuotationDto.quickSale === true,
          quotationNumber:
            createQuotationDto.quotationNumber ??
            updatedSeries.currentBudgetNumber,
          ...(createQuotationDto.createdAt
            ? { createdAt: new Date(createQuotationDto.createdAt) }
            : {}),
        },
      });

      await this.prisma.deliveryInfo.create({
        data: {
          daysAfterApproval: series.deliveryDeadline,
          quotation: {
            connect: {
              id: newQuotation.id,
            },
          },
        },
      });

      const defaultPaymentCondition =
        await this.prisma.paymentCondition.findFirst({
          where: {
            companyId: createQuotationDto.companyId,
            isActive: true,
          },
        });

      if (!defaultPaymentCondition) {
        throw new Error(
          'Nenhuma condição de pagamento encontrada para a empresa',
        );
      }

      await this.prisma.quotationPayment.create({
        data: {
          quotation: {
            connect: { id: newQuotation.id },
          },
          billing: series.billing,
          totalValue: 0,
          paymentCondition: {
            connect: { id: defaultPaymentCondition.id },
          },
        },
      });

      // History: register creation
      if (userId) {
        try {
          const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { name: true },
          });
          await this.prisma.quotationHistory.create({
            data: {
              quotationId: newQuotation.id,
              action: 'CREATED',
              description: `Orçamento criado por ${user?.name || 'Usuário'}`,
              createdBy: userId,
              createdByName: user?.name || null,
            } as any,
          });
        } catch (historyError) {
          this.logger.error(
            'Error creating quotation creation history:',
            historyError.stack,
          );
        }
      }

      return newQuotation;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Erro ao criar orçamento: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Erro ao criar orçamento: ${error.message}`,
      );
    }
  }

  /**
   * Busca contagem de orçamentos por status
   */
  async findAllQuantity(companyId: string, sellerId?: string) {
    const allStatuses: QuotationStatus[] = [
      'OPEN',
      'REJECTED',
      'DONE',
      'OVERDUE' as any,
    ];

    const where: any = {
      companyId,
      status: { in: allStatuses },
      isActive: true,
    };
    if (sellerId) {
      where.sellerId = sellerId;
    }

    const quotations = await this.prisma.quotation.findMany({
      where,
      select: {
        status: true,
        dueDate: true,
      },
    });

    const statusCount = allStatuses.reduce(
      (acc, status) => {
        acc[status] = 0;
        return acc;
      },
      {} as { [K in QuotationStatus]: number },
    );

    quotations.forEach((quotation) => {
      const isOverdue =
        quotation.dueDate &&
        quotation.dueDate < new Date() &&
        quotation.status === 'DONE';

      const status = isOverdue ? 'OVERDUE' : quotation.status;
      statusCount[status]++;
    });
    // Aba Aguardando (CRM-2, 27/10/2026): para retomar (contato até hoje ou
    // proposta vencendo), sem próximo contato e vencendo
    const scope = { companyId, ...(sellerId ? { sellerId } : {}) };
    const [retomar, semContato, vencendo] = await Promise.all([
      this.prisma.quotation.count({ where: { ...scope, ...dueWhere() } }),
      this.prisma.quotation.count({ where: { ...scope, ...noContactWhere() } }),
      this.prisma.quotation.count({ where: { ...scope, ...expiringWhere() } }),
    ]);

    const total = Object.values(statusCount).reduce((acc, cur) => acc + cur, 0);

    return {
      retomar,
      semContato,
      vencendo,
      ...statusCount,
      TOTAL: total,
    };
  }

  /**
   * Busca todos os orçamentos com filtros
   */
  async findAll(dto: FilterQuotationDto) {
    try {
      let where: Prisma.QuotationWhereInput = {
        status: { not: QuotationStatus.APPROVED },
        isActive: true,
      };

      if (dto.companyId) {
        where = {
          ...where,
          OR: [
            { companyId: dto.companyId },
            { subCompany: { id: dto.companyId } },
            { subCompany: { principalCompanyId: dto.companyId } },
          ],
        };
      }

      if (dto.search) {
        const searchNumber = parseInt(dto.search, 10);
        const isNumeric =
          !isNaN(searchNumber) && String(searchNumber) === dto.search.trim();
        where = {
          ...where,
          AND: [
            ...(where.AND
              ? Array.isArray(where.AND)
                ? where.AND
                : [where.AND]
              : []),
            {
              OR: [
                { description: { contains: dto.search, mode: 'insensitive' } },
                {
                  client: {
                    name: { contains: dto.search, mode: 'insensitive' },
                  },
                },
                {
                  seller: {
                    user: {
                      name: { contains: dto.search, mode: 'insensitive' },
                    },
                  },
                },
                ...(isNumeric
                  ? [{ quotationNumber: { equals: searchNumber } }]
                  : []),
              ],
            },
          ],
        };
      }

      if (dto.status) {
        if ((dto.status as any) === 'OVERDUE') {
          where = {
            ...where,
            status: 'DONE',
            dueDate: {
              lt: new Date(),
            },
          };
        } else {
          where = { ...where, status: dto.status };
        }
      }

      if (dto.sellerId) {
        where = { ...where, sellerId: dto.sellerId };
      }

      if (dto.serieId) {
        where = { ...where, seriesId: dto.serieId };
      }

      if (dto.clientId) {
        where = { ...where, clientId: dto.clientId };
      }

      if (dto.tagId) {
        where = { ...where, tagId: dto.tagId };
      }

      // "Para retomar": próximo contato até o fim de hoje ou proposta
      // vencendo, com o orçamento ainda em negociação (CRM-2, 27/10/2026);
      // "sem próximo contato" e "vencendo" são os outros filtros da aba
      // Aguardando
      if (dto.nextContact === 'due') {
        where = { ...where, ...dueWhere() };
      } else if (dto.nextContact === 'none') {
        where = { ...where, ...noContactWhere() };
      } else if (dto.nextContact === 'expiring') {
        where = { ...where, ...expiringWhere() };
      }

      if (dto.date) {
        const date = add(new Date(dto.date), { days: 1 });
        where = {
          ...where,
          finishedAt: {
            lte: endOfDay(date),
          },
        };
      }

      if (dto.startDate || dto.endDate) {
        const dateFilter: any = {};

        if (dto.startDate) {
          dateFilter.gte = new Date(dto.startDate);
        }

        if (dto.endDate) {
          const endDate = new Date(dto.endDate);
          endDate.setHours(23, 59, 59, 999);
          dateFilter.lte = endDate;
        }

        where = {
          ...where,
          createdAt: dateFilter,
        };
      }

      const [quotations, total] = await Promise.all([
        this.prisma.quotation.findMany({
          where,
          include: {
            tag: true,
            // O último contato registrado (CRM-2)
            contacts: {
              orderBy: { at: 'desc' },
              take: 1,
              select: { at: true, channel: true, outcome: true },
            },
            reasons: { select: { id: true, reason: true } },
            series: true,
            client: true,
            order: {
              select: {
                id: true,
              },
            },
            deliveryInfo: {
              select: {
                value: true,
              },
            },
            quotationPayment: {
              select: {
                finalValue: true,
                discountTotal: true,
                downPaymentAdditionalFee: true,
                commission: {
                  select: {
                    type: true,
                    totalCommission: true,
                  },
                },
                quotationInstallment: {
                  select: {
                    additionalFee: true,
                  },
                },
              },
            },
          },
          take: Number(dto.limit),
          skip: (Number(dto.page) - 1) * Number(dto.limit),
          // Pela data de criação (padrão) ou pelo próximo contato, sem data
          // por último (27/10/2026)
          orderBy:
            dto.orderBy === 'nextContactAt'
              ? [
                  { nextContactAt: { sort: dto.sort ?? 'asc', nulls: 'last' } },
                  { createdAt: 'desc' },
                ]
              : { createdAt: dto.sort ?? 'desc' },
        }),
        this.prisma.quotation.count({ where }),
      ]);

      // Os grupos da lista seguem a data da ordenação: dia de criação ou dia
      // do próximo contato ("none" para quem não tem)
      const byNextContact = dto.orderBy === 'nextContactAt';
      const grouped: Record<string, QuotationGroup> = quotations.reduce(
        (acc, quotation) => {
          const date = byNextContact
            ? (quotation as any).nextContactAt
              ? ((quotation as any).nextContactAt as Date)
                  .toISOString()
                  .split('T')[0]
              : 'none'
            : quotation.createdAt.toISOString().split('T')[0];
          if (!acc[date]) {
            acc[date] = {
              date: date,
              quotations: [],
            };
          }
          // Check if quotation is overdue
          const isOverdue =
            quotation.dueDate &&
            quotation.dueDate < new Date() &&
            quotation.status === 'DONE';

          acc[date].quotations.push({
            id: quotation.id,
            description: quotation.description,
            status: isOverdue ? 'OVERDUE' : quotation.status,
            dueDate: quotation.dueDate,
            finishedAt: quotation.finishedAt,
            totalValue: quotation.totalValue,
            deliveryInfo: quotation.deliveryInfo,
            quotationPayment: quotation.quotationPayment,
            tag: quotation.tag
              ? {
                  id: quotation.tag.id,
                  text: (quotation.tag as any).title,
                  color: quotation.tag.color,
                }
              : null,
            quickSale: quotation.quickSale || false,
            // Motivo da rejeição e acompanhamento (24/10/2026)
            rejectionReason: (quotation as any).reasons
              ? {
                  id: (quotation as any).reasons.id,
                  reason: (quotation as any).reasons.reason,
                }
              : null,
            nextContactAt: (quotation as any).nextContactAt ?? null,
            nextContactNote: (quotation as any).nextContactNote ?? null,
            lastContact: (quotation as any).contacts?.[0]
              ? {
                  at: (quotation as any).contacts[0].at,
                  channel: (quotation as any).contacts[0].channel,
                  outcome: (quotation as any).contacts[0].outcome,
                }
              : null,
            serie: quotation.series
              ? {
                  id: quotation.series.id,
                  name: (quotation.series as any).title,
                  code: quotation.series.code,
                  quotation: quotation.quotationNumber,
                }
              : null,
            client: quotation.client
              ? {
                  id: quotation.client.id,
                  name: quotation.client.name,
                  email: quotation.client.email,
                }
              : null,
          } as any);
          return acc;
        },
        {} as Record<string, QuotationGroup>,
      );

      const direction = dto.sort ?? (byNextContact ? 'asc' : 'desc');
      return {
        total,
        data: Object.values(grouped).sort((a, b) => {
          if (a.date === 'none') return 1;
          if (b.date === 'none') return -1;
          return direction === 'asc'
            ? a.date.localeCompare(b.date)
            : b.date.localeCompare(a.date);
        }),
      };
    } catch (error) {
      this.logger.error('Error in findAll:', error.stack);
      throw error;
    }
  }

  /**
   * Busca um orçamento por ID
   */
  async findAllForExport(dto: FilterQuotationDto) {
    const result = await this.findAll({
      ...dto,
      page: '1',
      limit: EXPORT_LIMIT,
    });

    return {
      total: result.total,
      exportLimit: Number(EXPORT_LIMIT),
      data: result.data.flatMap((group) =>
        group.quotations.map((quotation) => ({
          ...quotation,
          groupDate: group.date,
        })),
      ),
    };
  }

  async findOne(id: string) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id },
      include: QUOTATION_FIND_ONE_INCLUDE,
    });

    if (!quotation) {
      throw new NotFoundException(`Orçamento com ID '${id}' não encontrado.`);
    }

    // O preço base de cada item (EC-2, ALT-8): o retrato do item montado e
    // as faixas do plano entram por fora do include
    const base = await basePriceContext(
      this.prisma,
      this.planControl,
      quotation.companyId,
      quotation.quotationProduct
        .filter((item) => item.origin === 'COMPOSED')
        .map((item) => item.id),
    );
    return transformQuotationToResponse(quotation as any, base);
  }

  /**
   * Conta total de orçamentos
   */
  async count(companyId: string) {
    return this.prisma.quotation.count({
      where: { companyId },
    });
  }

  private parseDateField(value: string | Date, fieldName: string): Date {
    const parsedDate = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(parsedDate.getTime())) {
      throw new BadRequestException(`${fieldName} inválida.`);
    }

    return parsedDate;
  }

  /**
   * Atualiza um orçamento
   */
  async update(
    id: string,
    updateQuotationDto: UpdateQuotationDto,
    userId: string | undefined,
    sessionCompanyId: string,
  ) {
    try {
      const existingQuotation = await this.prisma.quotation.findUnique({
        where: { id },
        include: { series: { select: { code: true } } },
      });

      if (!existingQuotation) {
        throw new NotFoundException(`Orçamento com ID '${id}' não encontrado.`);
      }

      // Empresa e cadastros do corpo precisam ser da conta da sessão. O
      // formulário reenvia a empresa emissora: dentro da conta, grava como
      // na criação (antes ia direto para companyId, inclusive de outra
      // empresa)
      const account = updateQuotationDto.companyId
        ? await this.emitterOfAccount(
            updateQuotationDto.companyId,
            sessionCompanyId,
          )
        : null;
      const accountIds =
        account?.companyIds ??
        (await this.accountCompanies(sessionCompanyId)).map((c) => c.id);
      await this.assertRefsOfAccount(accountIds, {
        clientId: updateQuotationDto.clientId,
        sellerId: updateQuotationDto.sellerId,
        contactSourceId: updateQuotationDto.contactSourceId,
        tagId: updateQuotationDto.tagId,
      });

      const updateData: any = { ...updateQuotationDto };
      // Próximo contato: data ISO vira Date; null limpa
      if (updateQuotationDto.nextContactAt !== undefined) {
        updateData.nextContactAt = updateQuotationDto.nextContactAt
          ? new Date(updateQuotationDto.nextContactAt)
          : null;
      }
      if (account) {
        updateData.companyId = account.companyId;
        updateData.subCompanyId = account.subCompanyId;
      }

      // O formulário reenvia a série atual em toda edição. Só a troca real
      // renumera; sem ela o campo sai do update e do histórico.
      const isSeriesChange =
        !!updateQuotationDto.seriesId &&
        updateQuotationDto.seriesId !== existingQuotation.seriesId;
      if (!isSeriesChange) delete updateData.seriesId;
      // `as` evita que o TS estreite para null: a atribuição acontece dentro
      // do callback da transação, que a análise de fluxo não acompanha.
      let seriesChange = null as { before: string; after: string } | null;
      const hasContactId = Object.prototype.hasOwnProperty.call(
        updateQuotationDto,
        'contactId',
      );
      const hasApprovedAt = Object.prototype.hasOwnProperty.call(
        updateQuotationDto,
        'approvedAt',
      );

      if (hasContactId) {
        const contactId = updateQuotationDto.contactId || null;
        const clientId =
          updateQuotationDto.clientId ?? existingQuotation.clientId;

        if (contactId) {
          if (!clientId) {
            throw new BadRequestException(
              'Informe um cliente para vincular o responsável.',
            );
          }

          const contact = await this.prisma.contact.findFirst({
            where: {
              id: contactId,
              clientId,
            },
            select: { id: true },
          });

          if (!contact) {
            throw new BadRequestException(
              `Contato não encontrado ou não pertence ao cliente informado`,
            );
          }
        }

        updateData.contactId = contactId;
      }

      if (updateQuotationDto.createdAt) {
        updateData.createdAt = this.parseDateField(
          updateQuotationDto.createdAt,
          'Data de criação',
        );
      }

      if (hasApprovedAt) {
        if (existingQuotation.status !== QuotationStatus.APPROVED) {
          throw new BadRequestException(
            'A data de aprovação só pode ser alterada após o orçamento ser aprovado.',
          );
        }

        updateData.approvedAt = this.parseDateField(
          updateQuotationDto.approvedAt as string,
          'Data de aprovação',
        );
      }

      const updatedQuotation = await this.prisma.$transaction(
        async (prisma) => {
          if (isSeriesChange) {
            const reassigned = await reassignQuotationSeries(
              prisma,
              existingQuotation,
              updateQuotationDto.seriesId as string,
            );
            updateData.seriesId = reassigned.seriesId;
            updateData.quotationNumber = reassigned.quotationNumber;
            seriesChange = {
              before: `${existingQuotation.quotationNumber ?? ''}-${existingQuotation.series?.code ?? ''}`,
              after: `${reassigned.quotationNumber}-${reassigned.code}`,
            };
          }

          const quotation = await prisma.quotation.update({
            where: { id },
            data: updateData,
          });

          if (hasApprovedAt) {
            const deliveryInfo = await prisma.deliveryInfo.findUnique({
              where: { quotationId: id },
              select: {
                id: true,
                daysAfterApproval: true,
              },
            });

            if (deliveryInfo) {
              const estimatedDate = deliveryInfo.daysAfterApproval
                ? add(updateData.approvedAt, {
                    days: deliveryInfo.daysAfterApproval,
                  })
                : updateData.approvedAt;

              await prisma.deliveryInfo.update({
                where: { id: deliveryInfo.id },
                data: { estimatedDate },
              });

              await prisma.deliverySchedule.updateMany({
                where: { quotationId: id },
                data: { scheduledDate: estimatedDate },
              });

              // A entrega do projeto de produção vai junto (ELITE)
              await followDeliveryInTx(prisma, id, estimatedDate, {
                userId: userId ?? null,
                name: 'Edição da venda',
              });
            }
          }

          return quotation;
        },
      );

      // History: register edit with before/after changes
      if (userId) {
        try {
          const changedFields = Object.keys(updateData).filter((key) => {
            const before = existingQuotation[key];
            const after = updateData[key];

            if (before instanceof Date && after instanceof Date) {
              return before.getTime() !== after.getTime();
            }

            return after !== before;
          });

          if (changedFields.length > 0) {
            const user = await this.prisma.user.findUnique({
              where: { id: userId },
              select: { name: true },
            });

            const before: Record<string, unknown> = {};
            const after: Record<string, unknown> = {};
            for (const field of changedFields) {
              before[field] = existingQuotation[field];
              after[field] = updateData[field];
            }

            // Série e número andam juntos: registra "38-T1 → 12-V1" em vez de
            // um ID e um número soltos, que o histórico não saberia exibir.
            let fieldNames = changedFields;
            if (seriesChange) {
              for (const field of ['seriesId', 'quotationNumber']) {
                delete before[field];
                delete after[field];
              }
              before.serie = seriesChange.before;
              after.serie = seriesChange.after;
              fieldNames = [
                ...changedFields.filter(
                  (field) =>
                    field !== 'seriesId' && field !== 'quotationNumber',
                ),
                'serie',
              ];
            }

            await this.prisma.quotationHistory.create({
              data: {
                quotationId: id,
                action: 'EDITED',
                description: `Orçamento editado por ${user?.name || 'Usuário'} — campos: ${fieldNames.join(', ')}`,
                changes: { before, after },
                createdBy: userId,
                createdByName: user?.name || null,
              } as any,
            });
          }
        } catch (historyError) {
          this.logger.error(
            'Error creating quotation edit history:',
            historyError.stack,
          );
        }
      }

      return updatedQuotation;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Remove (desativa) um orçamento
   */
  remove(id: string) {
    return this.prisma.quotation.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /**
   * Busca fontes de contato
   */
  async findAllContactSources(companyId?: string) {
    try {
      return await this.prisma.contactSource.findMany({
        where: companyId
          ? { OR: [{ companyId }, { companyId: null }] }
          : undefined,
        orderBy: { name: 'asc' },
      });
    } catch (error) {
      this.logger.error('Error finding all contact sources:', error.stack);
      throw error;
    }
  }

  /**
   * Duplica um orçamento completo
   */
  async duplicate(
    quotationId: string,
    duplicateDto: DuplicateQuotationDto,
    userId?: string,
  ): Promise<Quotation> {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      include: {
        quotationProduct: {
          include: {
            items: {
              orderBy: { createdAt: 'asc' },
            },
            // O retrato da venda vai junto para a cópia (ORC-10)
            snapshot: { select: { data: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        deliveryInfo: true,
        quotationPayment: true,
      },
    });

    if (!quotation) {
      throw new NotFoundException(
        `Orçamento com ID '${quotationId}' não encontrado.`,
      );
    }

    // Cliente e responsável do corpo: da empresa do orçamento de origem
    await assertBelongsToCompany(
      this.prisma.client,
      duplicateDto.clientId,
      {
        companyId: {
          in: [quotation.companyId, quotation.subCompanyId].filter(
            (companyId): companyId is string => !!companyId,
          ),
        },
      },
      'Cliente não encontrado.',
    );
    if (duplicateDto.contactId) {
      const clientId = duplicateDto.clientId || quotation.clientId;
      const contact = clientId
        ? await this.prisma.contact.findFirst({
            where: { id: duplicateDto.contactId, clientId },
            select: { id: true },
          })
        : null;
      if (!contact) {
        throw new BadRequestException(
          'Contato não encontrado ou não pertence ao cliente informado',
        );
      }
    }

    // Atomic increment: increment first, then use the returned value
    const updatedSerie = await this.prisma.saleSeries.update({
      where: { id: quotation.seriesId },
      data: { currentBudgetNumber: { increment: 1 } },
      select: { currentBudgetNumber: true },
    });

    const createDto: CreateQuotationDto = {
      description:
        duplicateDto.description || `${quotation.description} (Cópia)`,
      clientId: duplicateDto.clientId || quotation.clientId,
      contactId: duplicateDto.contactId || quotation.contactId,
      contactSourceId: quotation.contactSourceId,
      totalValue: quotation.totalValue,
      sellerId: quotation.sellerId,
      seriesId: quotation.seriesId,
      companyId: quotation.companyId,
      subCompanyId: quotation.subCompanyId,
      // A cópia de uma venda rápida continua venda rápida (pode seguir sem
      // cliente).
      quickSale: quotation.quickSale,
      quotationNumber: updatedSerie.currentBudgetNumber,
    };

    const newQuotation = await this.prisma.quotation.create({
      data: createDto,
    });

    try {
      await this.prisma.deliveryInfo.create({
        data: {
          quotationId: newQuotation.id,
          deliveryType: quotation.deliveryInfo.deliveryType,
          daysAfterApproval: quotation.deliveryInfo.daysAfterApproval,
          modality: quotation.deliveryInfo.modality,
          supplierId: quotation.deliveryInfo.supplierId,
        },
      });

      await this.prisma.quotationPayment.create({
        data: {
          quotationId: newQuotation.id,
          paymentConditionId: quotation.quotationPayment.paymentConditionId,
          totalValue: quotation.quotationPayment.totalValue,
          finalValue: quotation.quotationPayment.finalValue,
        },
      });
    } catch (error) {
      this.logger.error(
        'Error creating deliveryInfo/payment for duplicate:',
        error.stack,
      );
    }

    let productsWithCurrentPrices = null;
    // O material de venda direta (ORG-1) com preço novo: o de hoje do
    // material ou da variação
    let materialsWithCurrentPrices: {
      id: string;
      price: number | null;
      variations: { id: string; price: number | null }[];
    }[] = [];
    if (duplicateDto.updatePrices) {
      // O item sem produto (material, montado na hora) fica fora da busca
      const productIds = quotation.quotationProduct
        .map((p) => p.productId)
        .filter(Boolean);
      const materialIds = quotation.quotationProduct
        .map((p) => p.materialId)
        .filter(Boolean);
      materialsWithCurrentPrices = materialIds.length
        ? await this.prisma.material.findMany({
            where: { id: { in: materialIds } },
            select: {
              id: true,
              price: true,
              variations: { select: { id: true, price: true } },
            },
          })
        : [];
      productsWithCurrentPrices = await this.prisma.product.findMany({
        where: {
          id: { in: productIds },
        },
        include: {
          items: true,
        },
      });
    }

    // As telas e o PDF ordenam produtos/itens por createdAt. Os inserts abaixo
    // são sequenciais, mas podem cair no mesmo milissegundo, então o createdAt
    // é atribuído explicitamente para preservar a ordem do orçamento original.
    const baseCreatedAt = Date.now();
    let createdAtOffset = 0;
    const nextCreatedAt = () => new Date(baseCreatedAt + createdAtOffset++);

    for (const product of quotation.quotationProduct) {
      const currentProduct = duplicateDto.updatePrices
        ? productsWithCurrentPrices.find((p) => p.id === product.productId)
        : null;

      const calculatedItems: {
        item: any;
        currentItem: any;
        calculatedSalePrice: number;
      }[] = [];

      for (const item of product.items) {
        const currentItem = currentProduct?.items.find(
          (i) => i.id === item.productItemId,
        );

        let calculatedSalePrice: number;

        if (duplicateDto.updatePrices) {
          const baseSalePrice = currentItem?.salePrice;

          if (!baseSalePrice) {
            calculatedSalePrice = item.salePrice ?? 0;
          } else {
            if (item.unitKind === 'DURATION' && item.duration) {
              const durationInHours = item.duration / 3600;
              calculatedSalePrice =
                baseSalePrice * durationInHours * item.quantity;
            } else if (item.unitKind === 'AREA' && item.width && item.height) {
              calculatedSalePrice =
                baseSalePrice * item.width * item.height * item.quantity;
            } else if (item.unitKind === 'DISTANCE' && item.distance) {
              calculatedSalePrice =
                baseSalePrice * item.distance * item.quantity;
            } else if (item.unitKind === 'LENGTH' && item.length) {
              calculatedSalePrice = baseSalePrice * item.length * item.quantity;
            } else if (item.unitKind === 'WEIGHT' && item.weight) {
              calculatedSalePrice = baseSalePrice * item.weight * item.quantity;
            } else if (item.unitKind === 'CAPACITY' && item.volume) {
              calculatedSalePrice = baseSalePrice * item.volume * item.quantity;
            } else {
              calculatedSalePrice = baseSalePrice * item.quantity;
            }
          }
        } else {
          calculatedSalePrice = item.salePrice ?? 0;
        }

        calculatedItems.push({ item, currentItem, calculatedSalePrice });
      }

      let newProductTotalValue = product.totalValue;
      let newProductFinalValue = product.finalValue;
      // O preço por unidade do material de hoje; nulo nos outros itens ou
      // quando o material ficou sem preço (fica o da venda)
      const material = product.materialId
        ? materialsWithCurrentPrices.find((m) => m.id === product.materialId)
        : null;
      const currentUnitPrice = material
        ? (material.variations.find((v) => v.id === product.materialVariationId)
            ?.price ?? material.price)
        : null;

      if (duplicateDto.updatePrices) {
        // O produto pelo preço de hoje das linhas de composição; o
        // material pelo preço de hoje; o item montado fica como foi
        newProductTotalValue = product.productId
          ? calculatedItems.reduce(
              (total, { calculatedSalePrice }) => total + calculatedSalePrice,
              0,
            )
          : currentUnitPrice !== null && currentUnitPrice !== undefined
            ? Math.round(currentUnitPrice * product.quantity)
            : product.totalValue;

        if (product.discount && product.discountType === 'PERCENT') {
          newProductFinalValue =
            newProductTotalValue -
            (newProductTotalValue * product.discount) / 100;
        } else if (product.discount && product.discountType === 'VALUE') {
          newProductFinalValue = newProductTotalValue - product.discount;
        } else {
          newProductFinalValue = newProductTotalValue;
        }
      }

      const productDto: DuplicateQuotationProductDto = {
        description: product.description,
        quantity: product.quantity,
        technicalDescription: product.technicalDescription,
        imageUrl: product.imageUrl,
        notes: product.notes,
        totalValue: newProductTotalValue,
        finalValue: newProductFinalValue,
        discount: product.discount,
        discountType: product.discountType,
        allowEditDescription: product.allowEditDescription,
        allowEditValues: product.allowEditValues,
        quotationId: newQuotation.id,
        productId: product.productId,
        createdAt: nextCreatedAt(),
      };

      // A variação, a composição escolhida, o acréscimo e as linhas do
      // item vão junto (Fase 4)
      const newProduct = await this.prisma.quotationProduct.create({
        data: {
          ...productDto,
          origin: product.origin,
          variationId: product.variationId,
          // O material de venda direta vai junto (ORG-1)
          materialId: product.materialId,
          materialVariationId: product.materialVariationId,
          // O item montado ganha uma cópia do rascunho: editar a cópia
          // não mexe no original (ORC-11)
          draftId:
            product.draftId && this.composed
              ? await this.composed.cloneDraft(product.draftId, newQuotation.id)
              : null,
          unitPrice:
            duplicateDto.updatePrices && currentUnitPrice != null
              ? currentUnitPrice
              : product.unitPrice,
          composition: product.composition ?? Prisma.DbNull,
          addition: product.addition,
          linesTotal: product.linesTotal,
          ...(product.snapshot && {
            snapshot: {
              create: { data: product.snapshot.data as Prisma.InputJsonValue },
            },
          }),
        },
      });
      await copyItemLines(this.prisma, product.id, newProduct.id);
      // Com preço novo, o valor refeito soma o acréscimo e as linhas
      if (
        duplicateDto.updatePrices &&
        (product.addition || product.linesTotal)
      ) {
        await this.prisma.quotationProduct.update({
          where: { id: newProduct.id },
          data: {
            finalValue: itemValue(
              newProductTotalValue ?? 0,
              product.discount,
              product.discountType,
              product.addition,
              product.linesTotal,
            ),
          },
        });
      }

      for (const {
        item,
        currentItem,
        calculatedSalePrice,
      } of calculatedItems) {
        const baseUnitCost = duplicateDto.updatePrices
          ? (currentItem?.unitCost ?? item.unitCost)
          : item.unitCost;

        const itemDto: DuplicateQuotationProductItemDto = {
          quotationId: newQuotation.id,
          productId: newProduct.productId,
          productItemId: item.productItemId,
          quotationProductId: newProduct.id,
          name: item.name,
          quantity: item.quantity,
          originalQuantity: item.originalQuantity,
          unitKind: item.unitKind as any,
          width: item.width,
          height: item.height,
          length: item.length,
          weight: item.weight,
          volume: item.volume,
          distance: item.distance,
          duration: item.duration,
          unitCost: baseUnitCost,
          salePrice: calculatedSalePrice,
          totalValue: calculatedSalePrice,
          createdAt: nextCreatedAt(),
        };

        try {
          await this.prisma.quotationProductItem.create({
            data: itemDto as any,
          });
        } catch (error) {
          this.logger.error(
            'Error creating quotation product item:',
            error.message,
          );
          throw new HttpException(
            'Erro interno do servidor',
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }
      }
    }

    await this.recalculateQuotationTotalValue(newQuotation.id);

    if (userId) {
      try {
        await this.prisma.quotationHistory.create({
          data: {
            quotationId: newQuotation.id,
            action: 'DUPLICATED',
            description: `Orçamento duplicado a partir do orçamento #${quotation.quotationNumber}`,
            changes: null,
            metadata: {
              originalQuotationId: quotation.id,
              originalQuotationNumber: quotation.quotationNumber,
              updatedPrices: duplicateDto.updatePrices || false,
              clientChanged: duplicateDto.clientId
                ? duplicateDto.clientId !== quotation.clientId
                : false,
              contactChanged: duplicateDto.contactId
                ? duplicateDto.contactId !== quotation.contactId
                : false,
              descriptionChanged: duplicateDto.description
                ? duplicateDto.description !== quotation.description
                : false,
            },
            createdBy: userId,
            createdByName: null,
          },
        });
      } catch (error) {
        this.logger.error(
          'Error creating quotation duplication history:',
          error.stack,
        );
      }
    }

    return newQuotation;
  }

  /**
   * Recalcula o valor total do orçamento somando finalValues dos produtos
   */
  async recalculateQuotationTotalValue(quotationId: string) {
    const quotationProducts = await this.prisma.quotationProduct.findMany({
      where: { quotationId },
      include: {
        items: true,
      },
    });

    const totalValue = quotationProducts.reduce((total, product) => {
      return total + product.finalValue;
    }, 0);

    await this.prisma.quotation.update({
      where: { id: quotationId },
      data: { totalValue },
    });
    await this.prisma.quotationPayment.update({
      where: {
        quotationId: quotationId,
      },
      data: { totalValue },
    });
  }
}
