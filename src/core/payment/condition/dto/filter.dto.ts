import { IsOptional, IsUUID } from 'class-validator';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

export class ConditionFilterDto extends BaseFilterDTO {
  @IsOptional()
  @IsUUID()
  clientId: string;

  @IsOptional()
  @IsUUID()
  paymentMethodId: string;
}
