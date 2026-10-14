import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const digits = (size: number) => new RegExp(`^[0-9]{${size}}$`);

/**
 * Os dados fiscais do material de venda direta (PO, 14/10/2026): o que vier
 * vazio sai do padrão do emissor na nota, como no produto sem cadastro fiscal.
 */
export class MaterialFiscalDto {
  @IsOptional()
  @Matches(digits(8), { message: 'O NCM tem 8 dígitos' })
  ncm?: string;

  @IsOptional()
  @Matches(digits(7), { message: 'O CEST tem 7 dígitos' })
  cest?: string;

  @IsOptional()
  @IsString()
  @MaxLength(14, { message: 'O código de barras tem até 14 dígitos' })
  cean?: string;

  @IsOptional()
  @IsString()
  @MaxLength(6, { message: 'A unidade comercial tem até 6 letras' })
  commercialUnit?: string;

  @IsOptional()
  @Matches(/^[0-8]$/, { message: 'A origem da mercadoria vai de 0 a 8' })
  icmsOrigin?: string;

  @IsOptional()
  @Matches(/^[0-9]{2,3}$/, { message: 'O CST do ICMS tem 2 ou 3 dígitos' })
  icmsCst?: string;

  @IsOptional()
  @Matches(digits(2), { message: 'O CST do PIS tem 2 dígitos' })
  pisCst?: string;

  @IsOptional()
  @Matches(digits(2), { message: 'O CST da COFINS tem 2 dígitos' })
  cofinsCst?: string;

  @IsOptional()
  @Matches(digits(2), { message: 'O CST do IPI tem 2 dígitos' })
  ipiCst?: string;

  @IsOptional()
  @Matches(digits(4), { message: 'O CFOP tem 4 dígitos' })
  cfopInState?: string;

  @IsOptional()
  @Matches(digits(4), { message: 'O CFOP tem 4 dígitos' })
  cfopOutState?: string;
}
