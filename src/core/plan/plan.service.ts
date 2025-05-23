import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreatePlanDTO, SubscriptionDTO } from './dtos/plan';
import { PrismaService } from 'nestjs-prisma';
import { PlanType } from '@prisma/client';

@Injectable()
export class PlanService {
  constructor(private prisma: PrismaService) {}
  private asaasToken = process.env.ASAAS_TOKEN;

  async create(createPlanDTO: CreatePlanDTO) {
    try {
      return this.prisma.plan.create({
        data: createPlanDTO,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        'Error creating plans: ' + error.message,
      );
    }
  }

  async findAll(companyId: string) {
    try {
      return await this.prisma.plan.findMany({
        where: {
          companyId,
        },
      });
    } catch (error) {
      throw new InternalServerErrorException(
        'Error fetching plans: ' + error.message,
      );
    }
  }

  async createDefaultPlans(companyId: string) {
    const defaultPlans = [
      {
        type: PlanType.START,
        name: 'Start',
        description:
          'Conceito:\nNa jornada da excelência, tudo começa com a organização e estruturação das informações. Esse ponto de partida cria as bases para que o negócio avance de forma organizada e profissional.\n\nObjetivo:\nDigitalizar e estruturar as informações principais, garantindo um início profissional e funcional.\n\nPrincipais Ações:\n- Cadastro de clientes, fornecedores, colaboradores e produtos.\n- Organização financeira básica: plano de contas, despesas fixas, folha de pagamento e receitas.\n- Implementação de um sistema simples para emissão de pedidos, controle financeiro básico e aparência profissional.\n\nResultados Esperados:\nA empresa sai do improviso, garantindo que nenhum trabalho seja esquecido, com informações organizadas e uma imagem mais profissional.',
        price: 115.0,
        companyId,
        isActive: true,
      },
      {
        type: PlanType.LITE,
        name: 'Lite',
        description:
          'Conceito:\nCom as bases lançadas na Etapa Start, o próximo passo é fortalecer a estabilidade financeira e comercial do negócio por meio de ferramentas mais robustas.\n\nObjetivo:\nAprofundar o controle financeiro da empresa enquanto integra informações comerciais (CRM) para facilitar tomadas de decisão estratégicas.\n\nPrincipais Ações:\n- Cadastro de produtos com composições básicas.\n- Controle financeiro avançado:\n  - Separação por contas bancárias.\n  - Definição de limites de crédito para clientes.\n  - Opção para repasse automático das taxas financeiras.\n- Introdução ao CRM (Gestão Comercial):\n  - Status das negociações em andamento.\n  - Motivos dos cancelamentos registrados no sistema.\n  - Histórico completo dos clientes.\n\nResultados Esperados:\nA empresa ganha previsibilidade financeira:\n- Redução significativa nas perdas financeiras;\n- Melhor controle sobre vendas/compras;\n- Decisões comerciais mais assertivas graças ao CRM integrado.\n\nObservação:\nAs informações cadastradas aqui evoluem diretamente pra próxima etapa — sem retrabalho!',
        price: 230.0,
        companyId,
        isActive: true,
      },
      {
        type: PlanType.PRO,
        name: 'Pro',
        description:
          'Conceito:\nEssa é a grande virada! Com a estabilidade financeira consolidada, é hora de aprofundar o conhecimento sobre custos e estruturar os processos para maior eficiência.\n\nObjetivo:\nCompreender os custos reais e criar padrões para processos e orçamentos.\n\nPrincipais Ações:\n- Cadastro detalhado de custos: mão de obra, materiais e equipamentos.\n- Identificação de trabalhos mais lucrativos e eliminação de serviços deficitários.\n- Padronização de processos de trabalho, criando fluxos claros para orçamentos e produção.\n- Delegação de funções antes centralizadas no dono da empresa baseada nesses processos.\n\nResultados Esperados:\nA empresa ganha clareza sobre sua operação, reduz sua linha de produtos para focar no que é mais lucrativo e padroniza processos, diminuindo a dependência exclusiva do dono.',
        price: 299.9,
        companyId,
        isActive: false,
      },
      {
        type: PlanType.ELITE,
        name: 'Elite',
        description:
          'Conceito:\nNesta etapa, a empresa passa a contar com um gerenciador de produção exclusivo, desenvolvido para atender às necessidades específicas de empresas de comunicação visual e gráficas.\n\nEle utiliza as composições criadas na Etapa 3 (máquinas, materiais e mão-de-obra) para organizar e monitorar todo o fluxo produtivo.\n\nO grande diferencial desse gerenciador é sua capacidade de se adaptar à estrutura única de cada empresa — seja por setores ou fluxos personalizados — além de permitir análises detalhadas da produtividade por setor e por colaborador.\n\nObjetivo:\nIntegrar todos os setores ao sistema, garantindo um gerenciamento eficiente da produção com base em dados reais.\n\nPrincipais Ações:\n- Implementação do gerenciador de produção;\n- Adaptável à estrutura específica da empresa;\n- Baseado nas composições detalhadas dos produtos criadas na Etapa 3;\n- Treinamento direcionado;\n- Cada setor aprende como usar o sistema dentro das suas funções específicas;\n- Análise avançada da produtividade;\n- Medição precisa por setor;\n- Avaliação individual dos colaboradores com base nos tempos estimados versus realizados.\n\nResultados Esperados:\n- Produção totalmente integrada entre os setores;\n- Redução de erros operacionais;\n- Identificação clara de gargalos produtivos (setores ou indivíduos);\n- Melhor aproveitamento dos recursos disponíveis (tempo, máquinas e materiais).\n\nO gerenciador foi projetado exclusivamente para empresas gráficas e de comunicação visual, oferecendo flexibilidade máxima sem complicações desnecessárias!',
        price: 399.9,
        companyId,
        isActive: false,
      },
      {
        type: PlanType.FULL,
        name: 'Full',
        description:
          'Conceito:\nNo ponto mais avançado da jornada, o foco é integrar todas as etapas anteriores para um gerenciamento completo e eficiente de estoque.\n\nObjetivo:\nGarantir que o estoque seja gerido com precisão, evitando desperdícios e alinhando-o às demandas da produção.\n\nPrincipais Ações:\n- Entrada de materiais correta no sistema.\n- Composição detalhada dos trabalhos, considerando aproveitamento e substituição de materiais na produção.\n- Integração com o gerenciamento de produção para rastrear o uso real de materiais.\n- Análise de custos estimados versus realizados, com ajustes nos processos para melhorias futuras.\n\nResultados Esperados:\nA empresa atinge excelência operacional, com controle total sobre custos, estoques e processos, resultando em mais eficiência e lucratividade.',
        price: 499.9,
        companyId,
        isActive: false,
      },
    ];

    const plans = await this.prisma.plan.findMany({
      where: {
        companyId,
      },
    });

    if (plans.length > 0) {
      return {
        message: 'Plans already exist',
      };
    }

    return Promise.all(defaultPlans.map((plan) => this.create(plan)));
  }

  async getCustomerId(customerData: SubscriptionDTO) {
    try {
      const urlID = 'https://api-sandbox.asaas.com/v3/customers';
      const optionsID = {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          access_token: this.asaasToken,
        },
        body: JSON.stringify({
          name: customerData.name,
          cpfCnpj: customerData.cpfCnpj,
          email: customerData.email,
          phone: customerData.phone,
          mobilePhone: customerData.mobilePhone,
          address: customerData.address,
          addressNumber: customerData.addressNumber,
          complement: customerData.complement,
          province: customerData.province,
          postalCode: customerData.postalCode,
        }),
      };
      const response = await fetch(urlID, optionsID);

      const clientData = await response.json();

      return clientData.id;
    } catch (error) {
      throw new InternalServerErrorException(
        'Error creating customer: ' + error.message,
      );
    }
  }

  async createSubscription(data: {
    billingType: any;
    cycle: any;
    customer: string;
    value: number;
    nextDueDate: string;
  }) {
    try {
      const urlSub = 'https://api-sandbox.asaas.com/v3/subscriptions';
      const optionsSub = {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          access_token: this.asaasToken,
        },
        body: JSON.stringify({
          billingType: data.billingType,
          cycle: data.cycle,
          customer: data.customer,
          value: data.value,
          nextDueDate: data.nextDueDate,
        }),
      };
      const responseSub = await fetch(urlSub, optionsSub);
      const subscriptionResponse = await responseSub.json();

      return subscriptionResponse;
    } catch (error) {
      throw new InternalServerErrorException(
        'Error creating subscription: ' + error.message,
      );
    }
  }

  async planSubscription(data: SubscriptionDTO) {
    try {
      const planExists = await this.prisma.plan.findUnique({
        where: {
          id: data.planId,
        },
      });

      if (!planExists) {
        throw new NotFoundException('Plan not found');
      }

      const companyExists = await this.prisma.company.findUnique({
        where: {
          id: data.companyId,
        },
      });

      if (!companyExists) {
        throw new NotFoundException('Company not found');
      }

      if (!planExists.isActive) {
        throw new BadRequestException('Plan is not active');
      }

      if (!data.isContractAccepted) {
        throw new BadRequestException('Contract not accepted');
      }

      const customerId = await this.getCustomerId(data);

      if (!customerId) {
        throw new BadRequestException('Customer not found');
      }

      const multiplier = data.extraUsers * 15;
      const totalPayment = data.planPrice + multiplier;

      await this.prisma.subscription.create({
        data: {
          plan: { connect: { id: data.planId } },
          company: { connect: { id: data.companyId } },
          billingType: data.billingType as any,
          planPrice: totalPayment,
          cycle: data.cycle,
          isContractAccepted: data.isContractAccepted,
          name: data.name,
          cpfCnpj: data.cpfCnpj,
          email: data.email,
          phone: data.phone,
          mobilePhone: data.mobilePhone,
          address: data.address,
          addressNumber: data.addressNumber,
        },
      });

      const subscription = await this.prisma.subscription.findFirst({
        where: {
          companyId: data.companyId,
        },
      });

      if (!subscription) {
        throw new BadRequestException('Subscription not found');
      }

      const subscriptionResponse = await this.createSubscription({
        billingType: subscription.billingType,
        cycle: subscription.cycle,
        customer: customerId,
        value: subscription.planPrice,
        nextDueDate: new Date(
          subscription.createdAt.getTime() + 40 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      });

      return { totalPrice: totalPayment, subscriptionResponse };
    } catch (error) {
      throw new InternalServerErrorException(
        'Error creating plan subscription: ' + error.message,
      );
    }
  }
}
