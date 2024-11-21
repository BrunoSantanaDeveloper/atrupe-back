import { IsNotEmpty, IsNumber, IsString, IsUUID } from 'class-validator';

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

  @IsNotEmpty()
  @IsUUID()
  companyId: string;
}
