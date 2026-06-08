import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';

type SnapshotItem = {
  codigo?: string;
  descricao?: string;
  unidade?: string;
  quantidade?: number;
  valorUnitario?: number;
  valorDesconto?: number;
};

type SnapshotPayment = {
  tipo?: string;
  valor?: number;
};

@Injectable()
export class NfceThermalService {
  constructor(private readonly prisma: PrismaService) {}

  async generateHtml(id: string, companyId: string): Promise<string> {
    const nfce = (await this.prisma.nfce.findFirst({
      where: { id, companyId },
      include: {
        company: {
          include: {
            address: {
              take: 1,
            },
          },
        },
      },
    })) as any;

    if (!nfce) {
      throw new NotFoundException('NFC-e nao encontrada');
    }

    const items = this.asArray<SnapshotItem>(nfce.itensSnapshot);
    const payments = this.asArray<SnapshotPayment>(nfce.pagamentosSnapshot);
    const address = nfce.company.address?.[0];
    const xml = nfce.xmlAutorizado || '';
    const protocol = nfce.protocolo || this.extractTag(xml, 'nProt');
    const authorizationDate =
      nfce.dataAutorizacao ||
      this.parseDate(this.extractTag(xml, 'dhRecbto')) ||
      nfce.dataEmissao;
    const accessKey = nfce.chaveAcesso || this.extractAccessKey(xml);
    const isHomologation = nfce.ambiente === 2;
    const qrImageSrc = nfce.qrCodeUrl || nfce.urlConsulta || '';

    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DANFE NFC-e ${this.escapeHtml(String(nfce.numero))}</title>
  <style>
    @page {
      size: 80mm auto;
      margin: 0;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10px;
      line-height: 1.25;
    }

    body {
      width: 80mm;
    }

    .receipt {
      width: 80mm;
      padding: 4mm 3mm 6mm;
    }

    .center {
      text-align: center;
    }

    .right {
      text-align: right;
    }

    .strong {
      font-weight: 700;
    }

    .title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .muted {
      font-size: 9px;
    }

    .divider {
      border-top: 1px dashed #000;
      margin: 6px 0;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      padding: 2px 0;
      vertical-align: top;
    }

    th {
      border-bottom: 1px solid #000;
      font-weight: 700;
      text-align: left;
    }

    .col-qty,
    .col-unit,
    .col-total {
      text-align: right;
      white-space: nowrap;
    }

    .item-desc {
      max-width: 36mm;
      word-break: break-word;
    }

    .totals-row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      padding: 1px 0;
    }

    .key {
      word-break: break-all;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.6px;
    }

    .qr {
      display: block;
      width: 34mm;
      height: 34mm;
      object-fit: contain;
      margin: 6px auto 2px;
    }

    .no-print {
      margin: 12px;
      width: calc(80mm - 24px);
      padding: 8px;
      border: 1px solid #000;
      background: #fff;
      cursor: pointer;
      font-size: 12px;
    }

    @media print {
      .no-print {
        display: none;
      }
    }
  </style>
</head>
<body>
  <button class="no-print" onclick="window.print()">Imprimir</button>
  <main class="receipt">
    <section class="center">
      <div class="title">${this.escapeHtml(nfce.company.legalName || nfce.company.name || '')}</div>
      <div>${this.escapeHtml(nfce.company.cnpj || '')}</div>
      <div>${this.escapeHtml(this.formatAddress(address))}</div>
      ${nfce.company.stateRegistration ? `<div>IE: ${this.escapeHtml(nfce.company.stateRegistration)}</div>` : ''}
    </section>

    <div class="divider"></div>

    <section class="center">
      <div class="title">DANFE NFC-e</div>
      <div>Documento Auxiliar da Nota Fiscal de Consumidor Eletronica</div>
      <div>NFC-e n. ${this.escapeHtml(String(nfce.numero))} Serie ${this.escapeHtml(String(nfce.serie))}</div>
      ${isHomologation ? '<div class="strong">EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</div>' : ''}
    </section>

    <div class="divider"></div>

    <section>
      <div class="strong">Itens</div>
      <table>
        <thead>
          <tr>
            <th>Descricao</th>
            <th class="col-qty">Qtde</th>
            <th class="col-unit">Unit.</th>
            <th class="col-total">Total</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => this.renderItem(item)).join('')}
        </tbody>
      </table>
    </section>

    <div class="divider"></div>

    <section>
      <div class="totals-row">
        <span>Subtotal</span>
        <span>${this.formatCurrency(this.getSubtotal(items, nfce.valorTotal, nfce.valorDesconto || 0))}</span>
      </div>
      <div class="totals-row">
        <span>Descontos</span>
        <span>${this.formatCurrency(nfce.valorDesconto || 0)}</span>
      </div>
      <div class="totals-row strong">
        <span>Valor total</span>
        <span>${this.formatCurrency(nfce.valorTotal || 0)}</span>
      </div>
      ${payments.map((payment) => this.renderPayment(payment)).join('')}
      ${
        nfce.valorTroco
          ? `<div class="totals-row"><span>Troco</span><span>${this.formatCurrency(nfce.valorTroco)}</span></div>`
          : ''
      }
    </section>

    <div class="divider"></div>

    <section>
      <div class="strong">Consumidor</div>
      <div>${this.escapeHtml(nfce.consumidorNome || 'Consumidor nao identificado')}</div>
      ${nfce.cpfConsumidor ? `<div>CPF/CNPJ: ${this.escapeHtml(nfce.cpfConsumidor)}</div>` : ''}
    </section>

    ${
      nfce.informacoesComplementares
        ? `<div class="divider"></div><section><div class="strong">Informacoes complementares</div><div>${this.escapeHtml(nfce.informacoesComplementares)}</div></section>`
        : ''
    }

    <div class="divider"></div>

    <section class="center">
      <div>Chave de acesso</div>
      <div class="key">${this.escapeHtml(this.formatAccessKey(accessKey))}</div>
      ${qrImageSrc ? `<img class="qr" src="${this.escapeAttr(qrImageSrc)}" alt="QR Code NFC-e" />` : ''}
      ${nfce.urlConsulta ? `<div class="muted">${this.escapeHtml(nfce.urlConsulta)}</div>` : ''}
    </section>

    <div class="divider"></div>

    <section class="center muted">
      ${protocol ? `<div>Protocolo: ${this.escapeHtml(protocol)}</div>` : ''}
      ${authorizationDate ? `<div>Autorizacao: ${this.escapeHtml(this.formatDate(authorizationDate))}</div>` : ''}
      <div>Impresso em ${this.escapeHtml(this.formatDate(new Date()))}</div>
    </section>
  </main>

  <script>
    window.addEventListener('load', function () {
      setTimeout(function () {
        window.print();
      }, 300);
    });
  </script>
</body>
</html>`;
  }

  private renderItem(item: SnapshotItem): string {
    const quantity = this.toNumber(item.quantidade);
    const unitValue = this.toNumber(item.valorUnitario);
    const discount = this.toNumber(item.valorDesconto);
    const total = Math.max(0, quantity * unitValue - discount);

    return `<tr>
      <td class="item-desc">${this.escapeHtml(item.descricao || item.codigo || 'Item')}</td>
      <td class="col-qty">${this.formatQuantity(quantity)} ${this.escapeHtml(item.unidade || '')}</td>
      <td class="col-unit">${this.formatCurrency(unitValue)}</td>
      <td class="col-total">${this.formatCurrency(total)}</td>
    </tr>`;
  }

  private renderPayment(payment: SnapshotPayment): string {
    return `<div class="totals-row">
      <span>${this.escapeHtml(this.paymentLabel(payment.tipo))}</span>
      <span>${this.formatCurrency(this.toNumber(payment.valor))}</span>
    </div>`;
  }

  private asArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
  }

  private getSubtotal(
    items: SnapshotItem[],
    total: number,
    discount: number,
  ): number {
    const subtotal = items.reduce(
      (sum, item) =>
        sum +
        this.toNumber(item.quantidade) * this.toNumber(item.valorUnitario),
      0,
    );

    return subtotal || total + discount;
  }

  private toNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private formatCurrency(value: number): string {
    return value.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  }

  private formatQuantity(value: number): string {
    return value.toLocaleString('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
    });
  }

  private formatDate(value: Date): string {
    return value.toLocaleString('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'medium',
    });
  }

  private formatAddress(address?: {
    street?: string | null;
    number?: string | null;
    neighborhood?: string | null;
    city?: string | null;
    state?: string | null;
    zipcode?: string | null;
  }): string {
    if (!address) return '';

    return [
      [address.street, address.number].filter(Boolean).join(', '),
      address.neighborhood,
      [address.city, address.state].filter(Boolean).join(' - '),
      address.zipcode,
    ]
      .filter(Boolean)
      .join(' | ');
  }

  private paymentLabel(code?: string): string {
    const labels: Record<string, string> = {
      '01': 'Dinheiro',
      '02': 'Cheque',
      '03': 'Cartao de credito',
      '04': 'Cartao de debito',
      '05': 'Credito loja',
      '10': 'Vale alimentacao',
      '11': 'Vale refeicao',
      '12': 'Vale presente',
      '13': 'Vale combustivel',
      '15': 'Boleto bancario',
      '16': 'Deposito bancario',
      '17': 'PIX',
      '18': 'Transferencia bancaria',
      '19': 'Programa de fidelidade',
      '90': 'Sem pagamento',
      '99': 'Outros',
    };

    return labels[code || ''] || `Pagamento ${code || ''}`.trim();
  }

  private extractTag(xml: string, tagName: string): string {
    const match = xml.match(new RegExp(`<${tagName}>(.*?)</${tagName}>`, 's'));
    return match?.[1]?.trim() || '';
  }

  private extractAccessKey(xml: string): string {
    const match = xml.match(/<infNFe[^>]*Id="NFe(\d{44})"/);
    return match?.[1] || '';
  }

  private parseDate(value: string): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private formatAccessKey(value: string): string {
    return value
      .replace(/\D/g, '')
      .replace(/(.{4})/g, '$1 ')
      .trim();
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private escapeAttr(value: string): string {
    return this.escapeHtml(value).replace(/`/g, '&#96;');
  }
}
