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

  // Sem este filtro a listagem devolvia tudo, e as condições inativadas
  // nas configurações continuavam aparecendo no seletor do orçamento.
  // A tela de configurações não envia o filtro, porque precisa mostrar
  // as inativas para reativar.
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
  })
  isActive?: boolean;
}
