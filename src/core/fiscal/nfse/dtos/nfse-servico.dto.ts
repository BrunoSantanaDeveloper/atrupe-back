import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsCnae,
  IsCodigoServico,
} from '../../../../helpers/validators/fiscal-servico';

/** Entrada da lista de serviços da empresa para emissão de NFS-e. */
export class NfseServicoDto {
  @ApiProperty({ description: 'Código da LC 116 (ex: 13.05)' })
  @IsString()
  @IsNotEmpty()
  @IsCodigoServico()
  codigo: string;

  @ApiProperty({ description: 'Descrição do serviço' })
  @IsString()
  @IsNotEmpty()
  descricao: string;

  @ApiPropertyOptional({ description: 'Alíquota de ISS (%)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  aliquotaIss?: number;

  @ApiPropertyOptional({ description: 'Código de tributação no município' })
  @IsString()
  @IsOptional()
  codTribMunicipio?: string;

  @ApiPropertyOptional({ description: 'CNAE do serviço' })
  @IsString()
  @IsOptional()
  @IsCnae()
  cnae?: string;

  @ApiPropertyOptional({ description: 'Nomenclatura Brasileira de Serviços' })
  @IsString()
  @IsOptional()
  nbs?: string;

  @ApiPropertyOptional({ description: 'Código de tributação nacional' })
  @IsString()
  @IsOptional()
  codTribNacional?: string;

  @ApiPropertyOptional({ description: 'Classificação tributária IBS/CBS' })
  @IsString()
  @IsOptional()
  codClassificacao?: string;

  @ApiPropertyOptional({ description: 'Serviço padrão da empresa' })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
