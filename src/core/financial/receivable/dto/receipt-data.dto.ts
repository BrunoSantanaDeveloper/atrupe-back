import { ApiProperty } from '@nestjs/swagger';

export class ReceiptItemDto {
  @ApiProperty({ example: '01' })
  reference: string;

  @ApiProperty({ example: 'Descrição do serviço' })
  description: string;

  @ApiProperty({ example: '00/00/0000' })
  date: string;

  @ApiProperty({ example: 'Pix' })
  paymentMethod: string;

  @ApiProperty({ example: 500.0 })
  value: number;
}

export class CompanyAddressDto {
  @ApiProperty({ example: 'Rua Exemplo' })
  street: string;

  @ApiProperty({ example: '123' })
  number: string;

  @ApiProperty({ example: 'Sala 1', required: false })
  complement?: string;

  @ApiProperty({ example: 'Centro' })
  neighborhood: string;

  @ApiProperty({ example: 'São Paulo' })
  city: string;

  @ApiProperty({ example: 'SP' })
  state: string;

  @ApiProperty({ example: '01234-567' })
  zipCode: string;
}

export class CompanySocialNetworksDto {
  @ApiProperty({ example: '@atrupe', required: false })
  instagram?: string;

  @ApiProperty({ example: 'atrupesistemas', required: false })
  facebook?: string;

  @ApiProperty({ example: 'atrupe', required: false })
  linkedin?: string;
}

export class CompanyDataDto {
  @ApiProperty({ example: 'Atrupe Comunicação Visual' })
  name: string;

  @ApiProperty({ example: '12.345.678/0001-90' })
  cnpj: string;

  @ApiProperty({ example: 'contato@atrupe.com.br' })
  email: string;

  @ApiProperty({ example: 'https://atrupe.com.br', required: false })
  siteUrl?: string;

  @ApiProperty({ type: CompanyAddressDto })
  address: CompanyAddressDto;

  @ApiProperty({ example: 'https://exemplo.com/logo.png', required: false })
  logo?: string;

  @ApiProperty({ type: CompanySocialNetworksDto, required: false })
  socialNetworks?: CompanySocialNetworksDto;
}

export class ReceiptDataResponseDto {
  @ApiProperty({ type: CompanyDataDto })
  company: CompanyDataDto;

  @ApiProperty({ example: 'Nome do Cliente' })
  clientName: string;

  @ApiProperty({ example: 2000.0 })
  totalValue: number;

  @ApiProperty({ example: '08' })
  day: string;

  @ApiProperty({ example: 'abril' })
  month: string;

  @ApiProperty({ example: '2024' })
  year: string;

  @ApiProperty({ type: [ReceiptItemDto] })
  items: ReceiptItemDto[];
}
