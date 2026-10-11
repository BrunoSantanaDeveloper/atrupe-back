import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateAssetDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsNumber()
  purchaseValue: number;

  @IsNotEmpty()
  @IsNumber()
  residualValue: number;

  @IsNotEmpty()
  @IsNumber()
  usefulLife: number;

  @IsNotEmpty()
  @IsUUID()
  typeId: string;

  @IsNotEmpty()
  @IsUUID()
  sectorId: string;

  // Ignorado: o patrimônio é sempre da empresa da sessão. Continua aceito
  // para não recusar (400) quem ainda o envia.
  @IsOptional()
  @IsUUID()
  companyId?: string;
}
