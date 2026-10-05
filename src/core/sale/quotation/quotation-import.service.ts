import {
  Injectable,
  BadRequestException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { QuotationStatus } from '@prisma/client';
import { add } from 'date-fns';
import * as fs from 'fs';
import * as fastCsv from 'fast-csv';
import { QuotationWorkflowService } from './quotation-workflow.service';

/**
 * QuotationImportService
 * Responsável por importação e deleção de orçamentos via CSV.
 */
@Injectable()
export class QuotationImportService {
  private readonly logger = new Logger(QuotationImportService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => QuotationWorkflowService))
    private workflowService: QuotationWorkflowService,
  ) {}

  /**
   * Deleta todos os orçamentos importados de uma empresa
   */
  async deleteImportedQuotations(
    companyId: string,
  ): Promise<{ success: boolean; message: string; deleted: number }> {
    try {
      // Find all quotations for the company
      const quotations = await this.prisma.quotation.findMany({
        where: { companyId },
        select: { id: true },
      });

      const quotationIds = quotations.map((q) => q.id);
      let deletedCount = 0;

      // Delete in a transaction to ensure data consistency
      await this.prisma.$transaction(async (prisma) => {
        // Delete quotation product items
        await prisma.quotationProductItem.deleteMany({
          where: {
            quotationId: {
              in: quotationIds,
            },
          },
        });

        // Delete quotation products
        await prisma.quotationProduct.deleteMany({
          where: {
            quotationId: {
              in: quotationIds,
            },
          },
        });

        // Delete quotation installments
        await prisma.quotationInstallment.deleteMany({
          where: {
            quotationPayment: {
              quotationId: {
                in: quotationIds,
              },
            },
          },
        });

        // Delete quotation payments
        await prisma.quotationPayment.deleteMany({
          where: {
            quotationId: {
              in: quotationIds,
            },
          },
        });

        // Delete delivery info
        await prisma.deliveryInfo.deleteMany({
          where: {
            quotationId: {
              in: quotationIds,
            },
          },
        });

        // Delete delivery schedules
        await prisma.deliverySchedule.deleteMany({
          where: {
            quotationId: {
              in: quotationIds,
            },
          },
        });

        // Delete production stages
        await prisma.productionStage.deleteMany({
          where: {
            schedule: {
              quotationId: {
                in: quotationIds,
              },
            },
          },
        });

        // Delete orders
        await prisma.order.deleteMany({
          where: {
            quotationId: {
              in: quotationIds,
            },
          },
        });

        // Finally, delete the quotations
        const result = await prisma.quotation.deleteMany({
          where: {
            id: {
              in: quotationIds,
            },
          },
        });

        deletedCount = result.count;
      });

      return {
        success: true,
        message: `Successfully deleted ${deletedCount} quotations and all related entities`,
        deleted: deletedCount,
      };
    } catch (error) {
      this.logger.error('Error deleting imported quotations:', error.stack);
      throw new BadRequestException(
        `Falha ao excluir orçamentos importados: ${error.message}`,
      );
    }
  }

  /**
   * Importa orçamentos de um arquivo CSV
   */
  async importQuotationsFromCsv(
    filePath: string,
    companyId: string,
  ): Promise<{ success: boolean; message: string; imported: number }> {
    try {
      // Find the admin seller
      const adminSeller = await this.prisma.employee.findFirst({
        where: {
          companyId,
          role: {
            name: 'Admin',
          },
        },
      });

      if (!adminSeller) {
        throw new BadRequestException(
          'Vendedor administrador não encontrado para a empresa',
        );
      }

      // Get all payment methods available for the company through payment conditions
      const paymentMethods = await this.prisma.paymentMethod.findMany({
        where: {
          isActive: true,
          paymentCondition: {
            some: {
              companyId,
              isActive: true,
            },
          },
        },
        take: 1,
      });

      if (paymentMethods.length === 0) {
        throw new BadRequestException(
          'No payment methods found for the company',
        );
      }

      const defaultPaymentMethod = paymentMethods[0];

      // Map for unit measures
      const unitMeasureMap = {
        M2: 'M²',
        M: 'MT',
        LT: 'LT',
        UN: 'UN',
        KG: 'KG',
        KM: 'KM',
        HH: 'HH',
      };

      // Map for delivery types
      const deliveryTypeMap = {
        '1': 'PICKUP',
        '2': 'INSTALLATION',
        '3': 'CARRIER',
        '4': 'CARRIER',
      };

      // Map for quotation status
      const statusMap = {
        Digitação: 'OPEN',
        Fechado: 'DONE',
        Finalizado: 'DONE',
        Entrega: 'APPROVED',
      };

      let importedCount = 0;
      const quotationsToApprove: string[] = [];

      // Auto detect delimiter based on the first line
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(1024);
      const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0);
      fs.closeSync(fd);

      const firstChunk = buffer.toString('utf-8', 0, bytesRead);
      const headLine = firstChunk.split('\n')[0] || '';
      const commaCount = (headLine.match(/,/g) || []).length;
      const semicolonCount = (headLine.match(/;/g) || []).length;
      const delimiter = semicolonCount > commaCount ? ';' : ',';

      // Read and process the CSV file
      const rows: any[] = [];
      await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
          .pipe(fastCsv.parse({ headers: true, delimiter }))
          .on('data', (row) => rows.push(row))
          .on('end', resolve)
          .on('error', reject);
      });

      // Process each row
      for (const row of rows) {
        try {
          const series = await this.prisma.saleSeries.findFirst({
            where: {
              code: row.venda_serie,
              companyId,
            },
          });

          if (!series) {
            console.warn(`Series not found for code: ${row.venda_serie}`);
            continue;
          }

          let clientId = null;
          if (row.cliente_nome) {
            const client = await this.prisma.client.findFirst({
              where: {
                name: row.cliente_nome,
                companyId,
              },
            });
            if (client) {
              clientId = client.id;
            }
          }

          const createdAt = new Date(row.cadastro_dt);
          const dueDate = series.proposalValidity
            ? add(createdAt, { days: series.proposalValidity })
            : add(createdAt, { days: 7 });

          let status = 'OPEN';
          if (row.confsubstatus_descr) {
            status = statusMap[row.confsubstatus_descr] || 'CANCELED';
          }

          const quotation = await this.prisma.quotation.create({
            data: {
              companyId,
              // A tela lê "Empresa" e monta a edição pela subempresa fiscal.
              subCompanyId: companyId,
              sellerId: adminSeller.id,
              clientId,
              seriesId: series.id,
              quotationNumber: parseInt(row.venda_numero),
              description: row.referencia || '',
              status: status as QuotationStatus,
              dueDate,
              totalValue: parseFloat(row.venda_valor_total) * 100 || 0,
              finishedAt:
                row.venda_data_fechamento &&
                row.venda_data_fechamento !== '0000-00-00 00:00:00'
                  ? new Date(row.venda_data_fechamento)
                  : null,
              approvedAt:
                row.venda_data_aprovacao &&
                row.venda_data_aprovacao !== '0000-00-00 00:00:00'
                  ? new Date(row.venda_data_aprovacao)
                  : null,
              createdAt: createdAt,
            },
          });

          const deliveryType = deliveryTypeMap[row.fkidtipoentrega] || 'PICKUP';
          const daysAfterApproval = parseInt(row.dias_apos_aprovacao) || 0;

          let estimatedDate = null;
          if (row.entrega_prazo && row.entrega_prazo !== '0000-00-00') {
            estimatedDate = new Date(row.entrega_prazo);
          } else if (daysAfterApproval > 0) {
            estimatedDate = add(createdAt, { days: daysAfterApproval });
          }

          await this.prisma.deliveryInfo.create({
            data: {
              quotationId: quotation.id,
              deliveryType: deliveryType as any,
              daysAfterApproval,
              estimatedDate,
              cost: parseFloat(row.entrega_custo) * 100 || 0,
              value: parseFloat(row.entrega_valor) * 100 || 0,
            },
          });

          // Find a default payment condition for the company
          const defaultPaymentCondition =
            await this.prisma.paymentCondition.findFirst({
              where: {
                companyId,
                isActive: true,
              },
            });

          if (!defaultPaymentCondition) {
            console.warn(`No payment condition found for company ${companyId}`);
            continue;
          }

          const quotationPayment = await this.prisma.quotationPayment.create({
            data: {
              quotationId: quotation.id,
              billing: series.billing,
              totalValue: parseFloat(row.venda_valor_final) * 100 || 0,
              finalValue:
                (parseFloat(row.venda_valor_final) -
                  parseFloat(row.venda_valor_desconto)) *
                  100 || 0,
              discountType: 'VALUE',
              discountValue: parseFloat(row.venda_valor_desconto) * 100 || 0,
              discountTotal: parseFloat(row.venda_valor_desconto) * 100 || 0,
              installmentQty: 1,
              minInstallmentQty: 1,
              maxInstallmentQty: 1,
              paymentConditionId: defaultPaymentCondition.id,
            },
          });

          await this.prisma.quotationInstallment.create({
            data: {
              quotationPaymentId: quotationPayment.id,
              paymentConditionId: defaultPaymentMethod.id,
              dueDate: quotation.dueDate,
              value:
                (parseFloat(row.venda_valor_final) -
                  parseFloat(row.venda_valor_desconto)) *
                  100 || 0,
            },
          });

          if (row.vendaitem_referencia) {
            const product = await this.prisma.product.findFirst({
              where: {
                name: row.vendaitem_referencia,
                companyId,
              },
              include: {
                items: true,
              },
            });

            if (product) {
              const quotationProduct =
                await this.prisma.quotationProduct.create({
                  data: {
                    quotationId: quotation.id,
                    productId: product.id,
                    description: row.vendaitem_referencia,
                    totalValue: parseFloat(row.vendaitem_valor_item) * 100 || 0,
                    discount:
                      parseFloat(row.vendaitem_valor_desconto) * 100 || 0,
                    discountType: 'VALUE',
                    finalValue:
                      parseFloat(row.vendaitem_valor_final) * 100 || 0,
                    quantity: parseInt(row.vendaitem_quantidade) || 1,
                  },
                });

              // Mapear código da unidade para UnitKind
              const unitMeasureCode =
                unitMeasureMap[row.vendaitem_un_com] || row.vendaitem_un_com;

              let unitKind = null;
              switch (unitMeasureCode) {
                case 'M²':
                  unitKind = 'AREA';
                  break;
                case 'MT':
                case 'CM':
                case 'MM':
                  unitKind = 'LENGTH';
                  break;
                case 'UN':
                  unitKind = 'UNITY';
                  break;
                case 'KG':
                case 'GR':
                case 'MG':
                  unitKind = 'WEIGHT';
                  break;
                case 'KM':
                  unitKind = 'DISTANCE';
                  break;
                case 'HH':
                  unitKind = 'DURATION';
                  break;
                case 'LT':
                case 'ML':
                  unitKind = 'CAPACITY';
                  break;
              }

              if (unitKind) {
                await this.prisma.quotationProductItem.create({
                  data: {
                    quotationId: quotation.id,
                    productId: product.id,
                    quotationProductId: quotationProduct.id,
                    productItemId: product.items[0]?.id || null,
                    name: row.vendaitem_referencia,
                    quantity: parseInt(row.vendaitem_quantidade) || 1,
                    originalQuantity: parseInt(row.vendaitem_quantidade) || 1,
                    unitKind: unitKind as any,
                    width: parseFloat(row.vendaitem_dim_largura) || null,
                    length: parseFloat(row.vendaitem_dim_comprimento) || null,
                    unitCost: parseFloat(row.vendaitem_custo_total) * 100 || 0,
                    salePrice: parseFloat(row.vendaitem_valor_item) * 100 || 0,
                    totalValue:
                      parseFloat(row.vendaitem_valor_total) * 100 || 0,
                  },
                });
              }
            }
          }

          if (row.confstatus_descr === 'Ordem de Serviço') {
            quotationsToApprove.push(quotation.id);
          }

          importedCount++;
        } catch (error) {
          this.logger.error(
            `Error processing row: ${JSON.stringify(row)}`,
            error.stack,
          );
        }
      }

      // Aprovar orçamentos que precisam
      if (this.workflowService) {
        for (const quotationId of quotationsToApprove) {
          try {
            await this.workflowService.approve(quotationId);
          } catch (error) {
            this.logger.error(
              `Error approving quotation ${quotationId}:`,
              error.stack,
            );
          }
        }
      }

      return {
        success: true,
        message: `Successfully imported ${importedCount} quotations`,
        imported: importedCount,
      };
    } catch (error) {
      this.logger.error('Error importing quotations from CSV:', error.stack);
      throw new BadRequestException(
        `Falha ao importar orçamentos: ${error.message}`,
      );
    }
  }
}
