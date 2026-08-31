import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class UpdateIcmsAliquotasDto {
  @ApiProperty({
    description:
      'Mapa de UF para alíquota interna em percentual. Enviar null em uma UF ' +
      'remove o ajuste e volta ao padrão do sistema.',
    example: { SP: 18, RJ: 20, MG: null },
  })
  @IsObject()
  aliquotas: Record<string, number | null>;
}
