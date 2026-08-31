import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsNumber,
  IsArray,
  ValidateNested,
  IsEnum,
  IsBoolean,
  Min,
  ValidateIf,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NfseStatus } from '@prisma/client';

export class NfseItemDto {
  @ApiProperty({ description: 'Sequência do item' })
  @IsInt()
  @Min(1)
  seq: number;

  @ApiProperty({ description: 'Código do item' })
  @IsString()
  @IsNotEmpty()
  codigo: string;

  @ApiProperty({ description: 'Descrição do serviço' })
  @IsString()
  @IsNotEmpty()
  descricao: string;

  @ApiProperty({ description: 'Quantidade' })
  @IsNumber()
  @Min(0.001)
  quantidade: number;

  @ApiProperty({ description: 'Valor unitário' })
  @IsNumber()
  @Min(0)
  valorUnitario: number;

  @ApiPropertyOptional({ description: 'Unidade de medida' })
  @IsString()
  @IsOptional()
  unidade?: string;

  @ApiPropertyOptional({ description: 'Código do serviço municipal' })
  @IsString()
  @IsOptional()
  codigoServico?: string;

  @ApiPropertyOptional({ description: 'Código CNAE' })
  @IsString()
  @IsOptional()
  cnae?: string;

  @ApiPropertyOptional({ description: 'Alíquota ISS' })
  @IsNumber()
  @IsOptional()
  aliquotaIss?: number;

  @ApiPropertyOptional({ description: 'ISS Retido' })
  @IsBoolean()
  @IsOptional()
  issRetido?: boolean;

  @ApiPropertyOptional({
    description: 'Código NBS do item; sem valor herda o NBS do serviço',
  })
  @IsString()
  @IsOptional()
  nbs?: string;
}

export class TomadorDto {
  @ApiProperty({ description: 'CNPJ do tomador' })
  @IsString()
  @IsOptional()
  cnpj?: string;

  @ApiPropertyOptional({ description: 'CPF do tomador' })
  @IsString()
  @IsOptional()
  cpf?: string;

  @ApiProperty({ description: 'Razão Social' })
  @IsString()
  @IsNotEmpty()
  razaoSocial: string;

  @ApiPropertyOptional({ description: 'Inscrição Municipal' })
  @IsString()
  @IsOptional()
  inscricaoMunicipal?: string;

  @ApiPropertyOptional({ description: 'Inscrição Estadual' })
  @IsString()
  @IsOptional()
  inscricaoEstadual?: string;

  @ApiProperty({ description: 'Endereço' })
  @IsString()
  @IsNotEmpty()
  endereco: string;

  @ApiProperty({ description: 'Número' })
  @IsString()
  @IsNotEmpty()
  numero: string;

  @ApiPropertyOptional({ description: 'Complemento' })
  @IsString()
  @IsOptional()
  complemento?: string;

  @ApiProperty({ description: 'Bairro' })
  @ValidateIf((o) => !o.codigoPais || o.codigoPais === '1058')
  @IsString()
  @IsNotEmpty()
  bairro: string;

  @ApiProperty({ description: 'CEP' })
  @ValidateIf((o) => !o.codigoPais || o.codigoPais === '1058')
  @IsString()
  @IsNotEmpty()
  cep: string;

  @ApiPropertyOptional({
    description: 'Código do município IBGE (resolvido via CEP quando omitido)',
  })
  @IsString()
  @IsOptional()
  codigoMunicipio?: string;

  @ApiPropertyOptional({
    description: 'Nome do município (resolvido via CEP quando omitido)',
  })
  @IsString()
  @IsOptional()
  municipio?: string;

  @ApiPropertyOptional({ description: 'UF (resolvida via CEP quando omitida)' })
  @IsString()
  @IsOptional()
  uf?: string;

  @ApiPropertyOptional({ description: 'Email' })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ description: 'Telefone' })
  @IsString()
  @IsOptional()
  telefone?: string;

  @ApiPropertyOptional({ description: 'Código do país (padrão: 1058)' })
  @IsString()
  @IsOptional()
  codigoPais?: string;

  @ApiPropertyOptional({ description: 'Identificação estrangeiro' })
  @IsString()
  @IsOptional()
  idEstrangeiro?: string;
}

// DTO simplificado para emissão a partir de uma ordem
export class EmitNfseFromOrderDto {
  @ApiProperty({ description: 'ID da ordem de serviço' })
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @ApiProperty({ description: 'Código do serviço municipal' })
  @IsString()
  @IsNotEmpty()
  codigoServico: string;

  @ApiProperty({ description: 'Discriminação do serviço' })
  @IsString()
  @IsNotEmpty()
  discriminacao: string;

  @ApiPropertyOptional({ description: 'Alíquota ISS (%)' })
  @IsNumber()
  @IsOptional()
  aliquotaIss?: number;

  @ApiPropertyOptional({ description: 'ISS Retido' })
  @IsBoolean()
  @IsOptional()
  issRetido?: boolean;

  // ── Campos adicionais da emissão (Reforma Tributária / retenções) ──
  @ApiPropertyOptional({
    description: 'Código indicador da operação (Anexo VII)',
  })
  @IsString()
  @IsOptional()
  cIndOp?: string;

  @ApiPropertyOptional({ description: 'Uso ou consumo pessoal: 0=Não, 1=Sim' })
  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(1)
  indFinal?: number;

  @ApiPropertyOptional({ description: 'Destinatário: 0=tomador, 1=diverso' })
  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(1)
  indDest?: number;

  @ApiPropertyOptional({ description: 'Ente governamental (1..4, 9=outro)' })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(9)
  tpEnteGov?: number;

  @ApiPropertyOptional({ description: 'Descrição do ente quando tpEnteGov=9' })
  @IsString()
  @IsOptional()
  xTpEnteGov?: string;

  @ApiPropertyOptional({ description: 'Tipo de operação com entes gov (1..5)' })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(5)
  tpOper?: number;

  @ApiPropertyOptional({ description: 'Trib. aproximados federais (R$)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  tribAproxFederal?: number;

  @ApiPropertyOptional({ description: 'Trib. aproximados estaduais (R$)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  tribAproxEstadual?: number;

  @ApiPropertyOptional({ description: 'Trib. aproximados municipais (R$)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  tribAproxMunicipal?: number;

  @ApiPropertyOptional({ description: 'Alíquota do INSS (%)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  aliquotaInss?: number;

  @ApiPropertyOptional({ description: 'Valor do INSS (R$)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  valorInss?: number;

  // ── Classificação escolhida na lista de serviços da empresa ──
  // Sobrepõe a classificação do produto (ProductFiscalData) quando informada.
  @ApiPropertyOptional({ description: 'NBS do serviço escolhido' })
  @IsString()
  @IsOptional()
  nbs?: string;

  @ApiPropertyOptional({ description: 'Código de tributação nacional' })
  @IsString()
  @IsOptional()
  codTribNacional?: string;

  @ApiPropertyOptional({ description: 'Código de tributação no município' })
  @IsString()
  @IsOptional()
  codTribMunicipio?: string;

  @ApiPropertyOptional({
    description: 'CST do IBS/CBS (ex.: 000 = tributação integral)',
  })
  @IsString()
  @IsOptional()
  cstIbsCbs?: string;

  @ApiPropertyOptional({ description: 'Classificação tributária IBS/CBS' })
  @IsString()
  @IsOptional()
  codClassificacao?: string;

  @ApiPropertyOptional({ description: 'CNAE do serviço escolhido' })
  @IsString()
  @IsOptional()
  cnae?: string;

  @ApiPropertyOptional({ description: 'ID do endereço selecionado' })
  @IsString()
  @IsOptional()
  addressId?: string;

  @ApiPropertyOptional({ description: 'Endereço do local de prestação' })
  @IsString()
  @IsOptional()
  entregaEndereco?: string;

  @ApiPropertyOptional({ description: 'Número do local de prestação' })
  @IsString()
  @IsOptional()
  entregaNumero?: string;

  @ApiPropertyOptional({ description: 'Complemento do local de prestação' })
  @IsString()
  @IsOptional()
  entregaComplemento?: string;

  @ApiPropertyOptional({ description: 'Bairro do local de prestação' })
  @IsString()
  @IsOptional()
  entregaBairro?: string;

  @ApiPropertyOptional({ description: 'CEP do local de prestação' })
  @IsString()
  @IsOptional()
  entregaCep?: string;

  @ApiPropertyOptional({ description: 'Município do local de prestação' })
  @IsString()
  @IsOptional()
  entregaMunicipio?: string;

  @ApiPropertyOptional({ description: 'UF do local de prestação' })
  @IsString()
  @IsOptional()
  entregaUf?: string;

  @ApiPropertyOptional({ description: 'Código IBGE do local de prestação' })
  @IsString()
  @IsOptional()
  entregaCodigoMunicipio?: string;

  // Campos opcionais para sobrescrever dados do tomador vindos do cadastro do cliente
  @ApiPropertyOptional({
    description: 'Razão social do tomador (sobrescreve o cadastro)',
  })
  @IsString()
  @IsOptional()
  tomadorRazaoSocial?: string;

  @ApiPropertyOptional({
    description: 'CNPJ ou CPF do tomador (sobrescreve o cadastro)',
  })
  @IsString()
  @IsOptional()
  tomadorCnpjCpf?: string;

  @ApiPropertyOptional({
    description: 'E-mail do tomador (sobrescreve o cadastro)',
  })
  @IsString()
  @IsOptional()
  tomadorEmail?: string;

  @ApiPropertyOptional({
    description: 'Telefone do tomador (sobrescreve o cadastro)',
  })
  @IsString()
  @IsOptional()
  tomadorTelefone?: string;

  @ApiPropertyOptional({
    description: 'Logradouro do tomador (sobrescreve o cadastro)',
  })
  @IsString()
  @IsOptional()
  tomadorEndereco?: string;

  @ApiPropertyOptional({
    description: 'Número do endereço do tomador (sobrescreve o cadastro)',
  })
  @IsString()
  @IsOptional()
  tomadorNumero?: string;

  @ApiPropertyOptional({
    description: 'Complemento do tomador (sobrescreve o cadastro)',
  })
  @IsString()
  @IsOptional()
  tomadorComplemento?: string;

  @ApiPropertyOptional({
    description: 'Bairro do tomador (sobrescreve o cadastro)',
  })
  @IsString()
  @IsOptional()
  tomadorBairro?: string;

  @ApiPropertyOptional({
    description: 'CEP do tomador (sobrescreve o cadastro)',
  })
  @IsString()
  @IsOptional()
  tomadorCep?: string;

  @ApiPropertyOptional({
    description: 'Município do tomador (sobrescreve o cadastro)',
  })
  @IsString()
  @IsOptional()
  tomadorMunicipio?: string;

  @ApiPropertyOptional({
    description: 'UF do tomador (sobrescreve o cadastro)',
  })
  @IsString()
  @IsOptional()
  tomadorUf?: string;
}

// DTO para emissão consolidada de NFS-e a partir de múltiplas ordens
export class EmitNfseFromOrdersDto {
  @ApiProperty({ description: 'IDs das ordens de serviço', type: [String] })
  @IsArray()
  @IsString({ each: true })
  orderIds: string[];

  @ApiProperty({ description: 'Código do serviço municipal' })
  @IsString()
  @IsNotEmpty()
  codigoServico: string;

  @ApiProperty({ description: 'Discriminação do serviço' })
  @IsString()
  @IsNotEmpty()
  discriminacao: string;

  @ApiPropertyOptional({ description: 'Alíquota ISS (%)' })
  @IsNumber()
  @IsOptional()
  aliquotaIss?: number;

  @ApiPropertyOptional({ description: 'ISS Retido' })
  @IsBoolean()
  @IsOptional()
  issRetido?: boolean;
  // ── Campos adicionais da emissão (Reforma Tributária / retenções) ──
  @ApiPropertyOptional({
    description: 'Código indicador da operação (Anexo VII)',
  })
  @IsString()
  @IsOptional()
  cIndOp?: string;

  @ApiPropertyOptional({ description: 'Uso ou consumo pessoal: 0=Não, 1=Sim' })
  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(1)
  indFinal?: number;

  @ApiPropertyOptional({ description: 'Destinatário: 0=tomador, 1=diverso' })
  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(1)
  indDest?: number;

  @ApiPropertyOptional({ description: 'Ente governamental (1..4, 9=outro)' })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(9)
  tpEnteGov?: number;

  @ApiPropertyOptional({ description: 'Descrição do ente quando tpEnteGov=9' })
  @IsString()
  @IsOptional()
  xTpEnteGov?: string;

  @ApiPropertyOptional({ description: 'Tipo de operação com entes gov (1..5)' })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(5)
  tpOper?: number;

  @ApiPropertyOptional({ description: 'Trib. aproximados federais (R$)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  tribAproxFederal?: number;

  @ApiPropertyOptional({ description: 'Trib. aproximados estaduais (R$)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  tribAproxEstadual?: number;

  @ApiPropertyOptional({ description: 'Trib. aproximados municipais (R$)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  tribAproxMunicipal?: number;

  @ApiPropertyOptional({ description: 'Alíquota do INSS (%)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  aliquotaInss?: number;

  @ApiPropertyOptional({ description: 'Valor do INSS (R$)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  valorInss?: number;

  // ── Classificação escolhida na lista de serviços da empresa ──
  // Sobrepõe a classificação do produto (ProductFiscalData) quando informada.
  @ApiPropertyOptional({ description: 'NBS do serviço escolhido' })
  @IsString()
  @IsOptional()
  nbs?: string;

  @ApiPropertyOptional({ description: 'Código de tributação nacional' })
  @IsString()
  @IsOptional()
  codTribNacional?: string;

  @ApiPropertyOptional({ description: 'Código de tributação no município' })
  @IsString()
  @IsOptional()
  codTribMunicipio?: string;

  @ApiPropertyOptional({
    description: 'CST do IBS/CBS (ex.: 000 = tributação integral)',
  })
  @IsString()
  @IsOptional()
  cstIbsCbs?: string;

  @ApiPropertyOptional({ description: 'Classificação tributária IBS/CBS' })
  @IsString()
  @IsOptional()
  codClassificacao?: string;

  @ApiPropertyOptional({ description: 'CNAE do serviço escolhido' })
  @IsString()
  @IsOptional()
  cnae?: string;

  @ApiPropertyOptional({ description: 'Endereço do local de prestação' })
  @IsString()
  @IsOptional()
  entregaEndereco?: string;

  @ApiPropertyOptional({ description: 'Número do local de prestação' })
  @IsString()
  @IsOptional()
  entregaNumero?: string;

  @ApiPropertyOptional({ description: 'Complemento do local de prestação' })
  @IsString()
  @IsOptional()
  entregaComplemento?: string;

  @ApiPropertyOptional({ description: 'Bairro do local de prestação' })
  @IsString()
  @IsOptional()
  entregaBairro?: string;

  @ApiPropertyOptional({ description: 'CEP do local de prestação' })
  @IsString()
  @IsOptional()
  entregaCep?: string;

  @ApiPropertyOptional({ description: 'Município do local de prestação' })
  @IsString()
  @IsOptional()
  entregaMunicipio?: string;

  @ApiPropertyOptional({ description: 'UF do local de prestação' })
  @IsString()
  @IsOptional()
  entregaUf?: string;

  // Campos opcionais para sobrescrever dados do tomador
  @ApiPropertyOptional({
    description: 'Razão social do tomador (sobrescreve o cadastro)',
  })
  @IsString()
  @IsOptional()
  tomadorRazaoSocial?: string;

  @ApiPropertyOptional({
    description: 'CNPJ ou CPF do tomador (sobrescreve o cadastro)',
  })
  @IsString()
  @IsOptional()
  tomadorCnpjCpf?: string;

  @ApiPropertyOptional({
    description: 'E-mail do tomador (sobrescreve o cadastro)',
  })
  @IsString()
  @IsOptional()
  tomadorEmail?: string;

  @ApiPropertyOptional({
    description: 'Telefone do tomador (sobrescreve o cadastro)',
  })
  @IsString()
  @IsOptional()
  tomadorTelefone?: string;

  @ApiPropertyOptional({
    description: 'Logradouro do tomador (sobrescreve o cadastro)',
  })
  @IsString()
  @IsOptional()
  tomadorEndereco?: string;

  @ApiPropertyOptional({
    description: 'Número do endereço do tomador (sobrescreve o cadastro)',
  })
  @IsString()
  @IsOptional()
  tomadorNumero?: string;

  @ApiPropertyOptional({
    description: 'Complemento do tomador (sobrescreve o cadastro)',
  })
  @IsString()
  @IsOptional()
  tomadorComplemento?: string;

  @ApiPropertyOptional({
    description: 'Bairro do tomador (sobrescreve o cadastro)',
  })
  @IsString()
  @IsOptional()
  tomadorBairro?: string;

  @ApiPropertyOptional({
    description: 'CEP do tomador (sobrescreve o cadastro)',
  })
  @IsString()
  @IsOptional()
  tomadorCep?: string;

  @ApiPropertyOptional({
    description: 'Município do tomador (sobrescreve o cadastro)',
  })
  @IsString()
  @IsOptional()
  tomadorMunicipio?: string;

  @ApiPropertyOptional({
    description: 'UF do tomador (sobrescreve o cadastro)',
  })
  @IsString()
  @IsOptional()
  tomadorUf?: string;
}

// DTO completo para emissão manual
export class EmitNfseDto {
  @ApiPropertyOptional({ description: 'ID do orçamento' })
  @IsString()
  @IsOptional()
  quotationId?: string;

  @ApiPropertyOptional({ description: 'ID da ordem de serviço' })
  @IsString()
  @IsOptional()
  orderId?: string;

  @ApiPropertyOptional({ description: 'Data de competência' })
  @IsString()
  @IsOptional()
  dataCompetencia?: string;

  @ApiProperty({ description: 'Natureza da operação' })
  @IsInt()
  @IsNotEmpty()
  naturezaOperacao: number; // 1 = Tributação no município, etc.

  @ApiPropertyOptional({ description: 'Regime especial de tributação' })
  @IsInt()
  @IsOptional()
  regimeEspecial?: number;

  @ApiPropertyOptional({ description: 'Optante Simples Nacional' })
  @IsInt()
  @IsOptional()
  optanteSimplesNacional?: number; // 1 = Sim, 2 = Não

  @ApiPropertyOptional({ description: 'Incentivador cultural' })
  @IsInt()
  @IsOptional()
  incentivadorCultural?: number; // 1 = Sim, 2 = Não

  @ApiProperty({ description: 'Código do serviço municipal' })
  @IsString()
  @IsNotEmpty()
  codigoServico: string;

  @ApiPropertyOptional({ description: 'Código CNAE' })
  @IsString()
  @IsOptional()
  cnae?: string;

  @ApiProperty({ description: 'Discriminação do serviço' })
  @IsString()
  @IsNotEmpty()
  discriminacao: string;

  @ApiProperty({ description: 'Código do município de prestação' })
  @IsString()
  @IsNotEmpty()
  codigoMunicipio: string;

  // Classificação fiscal do serviço. Já é cadastrada em ProductFiscalData e
  // vinha sendo descartada na montagem do payload; cada campo omitido quando
  // não cadastrado, para não alterar quem já emite sem eles.
  @ApiPropertyOptional({
    description: 'Nomenclatura Brasileira de Serviços (NBS)',
  })
  @IsString()
  @IsOptional()
  nbs?: string;

  @ApiPropertyOptional({ description: 'Código de tributação nacional' })
  @IsString()
  @IsOptional()
  codTribNacional?: string;

  @ApiPropertyOptional({
    description: 'Código de tributação no município (ex: 000, 001)',
  })
  @IsString()
  @IsOptional()
  codTribMunicipio?: string;

  // `cnae` já é declarado acima neste mesmo DTO.

  @ApiPropertyOptional({
    description: 'CST do IBS/CBS (ex.: 000 = tributação integral)',
  })
  @IsString()
  @IsOptional()
  cstIbsCbs?: string;

  @ApiPropertyOptional({
    description: 'Código de classificação tributária do IBS/CBS',
  })
  @IsString()
  @IsOptional()
  codClassificacao?: string;

  // ── Campos da Reforma Tributária e retenções (níveis RPS/Valores) ──
  // Nomes e semântica conforme Layout_Recepcao_NFSe_Reforma_Tributaria v4
  // (repositório migrate-company/integracao-InvoiCy-BR).

  @ApiPropertyOptional({
    description:
      'Base de cálculo do IBS/CBS; sem valor usa a base do ISS menos o ISS',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  baseIbsCbs?: number;

  @ApiPropertyOptional({
    description: 'Código indicador da operação (Anexo VII, 6 dígitos)',
  })
  @IsString()
  @IsOptional()
  cIndOp?: string;

  @ApiPropertyOptional({
    description: 'Operação de uso ou consumo pessoal: 0=Não, 1=Sim',
  })
  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(1)
  indFinal?: number;

  @ApiPropertyOptional({
    description:
      'Destinatário dos serviços: 0=tomador é o destinatário, 1=destinatário diverso',
  })
  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(1)
  indDest?: number;

  @ApiPropertyOptional({
    description:
      'Ente governamental: 1=União, 2=Estado, 3=DF, 4=Município, 9=outro',
  })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(9)
  tpEnteGov?: number;

  @ApiPropertyOptional({ description: 'Descrição do ente quando tpEnteGov=9' })
  @IsString()
  @IsOptional()
  xTpEnteGov?: string;

  @ApiPropertyOptional({
    description:
      'Tipo de operação com entes governamentais (1..5, layout InvoiCy)',
  })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(5)
  tpOper?: number;

  @ApiPropertyOptional({
    description: 'Valor aproximado dos tributos federais',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  tribAproxFederal?: number;

  @ApiPropertyOptional({
    description: 'Valor aproximado dos tributos estaduais',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  tribAproxEstadual?: number;

  @ApiPropertyOptional({
    description: 'Valor aproximado dos tributos municipais',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  tribAproxMunicipal?: number;

  @ApiProperty({ description: 'Valor dos serviços' })
  @IsNumber()
  @Min(0)
  valorServicos: number;

  @ApiPropertyOptional({ description: 'Valor das deduções' })
  @IsNumber()
  @IsOptional()
  valorDeducoes?: number;

  @ApiPropertyOptional({ description: 'Alíquota ISS' })
  @IsNumber()
  @IsOptional()
  aliquotaIss?: number;

  @ApiPropertyOptional({ description: 'ISS Retido' })
  @IsBoolean()
  @IsOptional()
  issRetido?: boolean;

  @ApiPropertyOptional({ description: 'Alíquota PIS' })
  @IsNumber()
  @IsOptional()
  aliquotaPis?: number;

  @ApiPropertyOptional({ description: 'Valor PIS' })
  @IsNumber()
  @IsOptional()
  valorPis?: number;

  @ApiPropertyOptional({ description: 'Alíquota COFINS' })
  @IsNumber()
  @IsOptional()
  aliquotaCofins?: number;

  @ApiPropertyOptional({ description: 'Valor COFINS' })
  @IsNumber()
  @IsOptional()
  valorCofins?: number;

  @ApiPropertyOptional({ description: 'Alíquota INSS' })
  @IsNumber()
  @IsOptional()
  aliquotaInss?: number;

  @ApiPropertyOptional({ description: 'Valor INSS' })
  @IsNumber()
  @IsOptional()
  valorInss?: number;

  @ApiPropertyOptional({ description: 'Alíquota IR' })
  @IsNumber()
  @IsOptional()
  aliquotaIr?: number;

  @ApiPropertyOptional({ description: 'Valor IR' })
  @IsNumber()
  @IsOptional()
  valorIr?: number;

  @ApiPropertyOptional({ description: 'Alíquota CSLL' })
  @IsNumber()
  @IsOptional()
  aliquotaCsll?: number;

  @ApiPropertyOptional({ description: 'Valor CSLL' })
  @IsNumber()
  @IsOptional()
  valorCsll?: number;

  @ApiProperty({ description: 'Dados do tomador', type: TomadorDto })
  @ValidateNested()
  @Type(() => TomadorDto)
  tomador: TomadorDto;

  @ApiPropertyOptional({ description: 'Itens do serviço', type: [NfseItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NfseItemDto)
  @IsOptional()
  itens?: NfseItemDto[];

  @ApiPropertyOptional({ description: 'Endereço do local de prestação' })
  @IsString()
  @IsOptional()
  entregaEndereco?: string;

  @ApiPropertyOptional({ description: 'Número do local de prestação' })
  @IsString()
  @IsOptional()
  entregaNumero?: string;

  @ApiPropertyOptional({ description: 'Complemento do local de prestação' })
  @IsString()
  @IsOptional()
  entregaComplemento?: string;

  @ApiPropertyOptional({ description: 'Bairro do local de prestação' })
  @IsString()
  @IsOptional()
  entregaBairro?: string;

  @ApiPropertyOptional({ description: 'CEP do local de prestação' })
  @IsString()
  @IsOptional()
  entregaCep?: string;

  @ApiPropertyOptional({ description: 'Município do local de prestação' })
  @IsString()
  @IsOptional()
  entregaMunicipio?: string;

  @ApiPropertyOptional({ description: 'UF do local de prestação' })
  @IsString()
  @IsOptional()
  entregaUf?: string;

  @ApiPropertyOptional({ description: 'Código IBGE do local de prestação' })
  @IsString()
  @IsOptional()
  entregaCodigoMunicipio?: string;
}

export class CancelNfseDto {
  @ApiProperty({
    description: 'Justificativa do cancelamento (mín 15 caracteres)',
  })
  @IsString()
  @IsNotEmpty()
  justificativa: string;

  @ApiPropertyOptional({ description: 'Código do cancelamento' })
  @IsString()
  @IsOptional()
  codigoCancelamento?: string;
}

export class NfseFilterDto {
  @ApiPropertyOptional({ description: 'Status da NFS-e', enum: NfseStatus })
  @IsEnum(NfseStatus)
  @IsOptional()
  status?: NfseStatus;

  @ApiPropertyOptional({ description: 'Data inicial' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Data final' })
  @IsString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Número da NFS-e' })
  @IsInt()
  @IsOptional()
  numero?: number;

  @ApiPropertyOptional({ description: 'ID da ordem' })
  @IsString()
  @IsOptional()
  orderId?: string;

  @ApiPropertyOptional({ description: 'Página', default: 1 })
  @IsInt()
  @IsOptional()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Itens por página', default: 20 })
  @IsInt()
  @IsOptional()
  @Min(1)
  limit?: number;
}
