import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

export class ConditionFilterDto extends BaseFilterDTO {
  @IsOptional()
  @IsUUID()
  clientId: string;

  @IsOptional()
  @IsUUID()
  paymentMethodId: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value !== undefined ? Boolean(value) : false; // padrão false
  })
  grouped?: boolean = false;
}
