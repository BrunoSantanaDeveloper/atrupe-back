import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BrasilApiService } from 'src/svc/plug/brasilapi/brasilapi.service';
import { CNPJResponse } from 'src/svc/plug/brasilapi/dto/cnpj.dto';
import { validCNPJ } from 'src/helpers/validators/cnpj';
import { RegistryPartner, registryAllowsVerification } from './representatives';

export interface CompanyRegistryRecord {
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  registrationStatus: string | null;
  isActive: boolean;
  address: {
    street: string;
    number: string;
    complement: string;
    neighborhood: string;
    city: string;
    state: string;
    zipcode: string;
  };
  /** Sócios pessoa física, com o CPF mascarado como a base publica. */
  partners: RegistryPartner[];
  fetchedAt: string;
}

/** O que a tela recebe: nunca os nomes do quadro societário. */
export interface CompanyRegistryPublicView {
  found: boolean;
  cnpj: string;
  legalName?: string;
  tradeName?: string | null;
  registrationStatus?: string | null;
  isActive?: boolean;
  address?: CompanyRegistryRecord['address'];
  /** Há administrador com CPF publicado contra o qual conferir? */
  canVerifyRepresentative?: boolean;
}

/**
 * Consulta de CNPJ da contratação.
 *
 * Pelo backend, e não pelo navegador: o quadro societário é o que confere o
 * representante legal, e a conferência não pode depender do que o cliente
 * diz ter recebido da base pública.
 *
 * O quadro NUNCA é devolvido à tela (a spec proíbe oferecer a lista de sócios:
 * a pergunta é quem responde pela empresa, e a lista induziria a escolher
 * um nome em vez de informar o próprio CPF). Só o veredito sai daqui.
 *
 * Cache curto porque a mesma empresa é consultada algumas vezes numa única
 * contratação (preenchimento, conferência do CPF, confirmação).
 */
@Injectable()
export class CompanyRegistryService {
  private readonly logger = new Logger(CompanyRegistryService.name);
  private static readonly TTL_MS = 5 * 60 * 1000;
  private readonly cache = new Map<
    string,
    { at: number; record: CompanyRegistryRecord | null }
  >();

  constructor(private readonly brasilApi: BrasilApiService) {}

  /** O registro, ou null quando o CNPJ não existe na base. */
  async lookup(cnpj: string): Promise<CompanyRegistryRecord | null> {
    const digits = String(cnpj ?? '').replace(/\D/g, '');
    if (!validCNPJ(digits)) {
      throw new BadRequestException('CNPJ inválido.');
    }

    const cached = this.cache.get(digits);
    if (cached && Date.now() - cached.at < CompanyRegistryService.TTL_MS) {
      return cached.record;
    }

    try {
      const raw = await this.brasilApi.companyRegistry(digits);
      const record = this.toRecord(digits, raw);
      this.cache.set(digits, { at: Date.now(), record });
      return record;
    } catch (error) {
      if (error instanceof NotFoundException) {
        this.cache.set(digits, { at: Date.now(), record: null });
        return null;
      }
      this.logger.warn(
        `Consulta de CNPJ indisponível (${digits}): ${error.message}`,
      );
      throw new ServiceUnavailableException(
        'Não foi possível consultar o CNPJ agora. Preencha os dados da empresa manualmente.',
      );
    }
  }

  async publicView(cnpj: string): Promise<CompanyRegistryPublicView> {
    const digits = String(cnpj ?? '').replace(/\D/g, '');
    const record = await this.lookup(digits);
    if (!record) return { found: false, cnpj: digits };
    return {
      found: true,
      cnpj: record.cnpj,
      legalName: record.legalName,
      tradeName: record.tradeName,
      registrationStatus: record.registrationStatus,
      isActive: record.isActive,
      address: record.address,
      canVerifyRepresentative: registryAllowsVerification(record.partners),
    };
  }

  private toRecord(cnpj: string, raw: CNPJResponse): CompanyRegistryRecord {
    const partners: RegistryPartner[] = (raw.qsa ?? [])
      // 2 = pessoa física: só pessoa física responde como representante legal.
      .filter((s) => Number(s.identificador_de_socio) === 2)
      .map((s) => ({
        name: s.nome_socio,
        qualification: s.qualificacao_socio ?? '',
        qualificationCode: s.codigo_qualificacao_socio ?? null,
        maskedDocument: String(s.cnpj_cpf_do_socio ?? ''),
      }));

    const status = raw.descricao_situacao_cadastral ?? null;
    return {
      cnpj,
      legalName: raw.razao_social,
      // Sem nome fantasia no registro, a razão social faz as vezes dele.
      tradeName: raw.nome_fantasia || null,
      registrationStatus: status,
      isActive: String(status ?? '').toUpperCase() === 'ATIVA',
      address: {
        street: [raw.descricao_tipo_de_logradouro, raw.logradouro]
          .filter(Boolean)
          .join(' '),
        number: raw.numero || '',
        complement: raw.complemento || '',
        neighborhood: raw.bairro || '',
        city: raw.municipio || '',
        state: raw.uf || '',
        zipcode: raw.cep ? String(raw.cep).padStart(8, '0') : '',
      },
      partners,
      fetchedAt: new Date().toISOString(),
    };
  }
}
