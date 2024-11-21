import { ArrayNotEmpty, IsArray } from 'class-validator';

export class CreateInvoiceDto {
  // @IsNotEmpty()
  // @IsString()
  // number: string;

  // @IsNotEmpty()
  // @IsDate()
  // date: Date;

  // @IsNotEmpty()
  // @IsDecimal()
  // amount: number;

  // @IsNotEmpty()
  // @IsUUID()
  // companyId: string;

  @IsArray()
  @ArrayNotEmpty()
  // @ValidateNested({ each: true })
  // @Type(() => String)
  // @IsUUID()
  ids: string[];
}
