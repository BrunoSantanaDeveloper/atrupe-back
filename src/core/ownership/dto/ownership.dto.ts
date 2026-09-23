import {
  Equals,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsCnpj } from 'src/helpers/validators/cnpj';
import { IsCpf } from 'src/helpers/validators/cpf';
import {
  CheckoutRepresentativeDto,
  CheckoutTermsDto,
} from '../../subscriptions/dto/checkout.dto';

/**
 * O envio pede só o e-mail de destino: os dados da empresa que recebe
 * pertencem a quem recebe. E a consequência — o ambiente inteiro muda de
 * mãos e quem envia perde o acesso — precisa vir declarada no pedido.
 */
export class SendOwnershipTransferDto {
  @ApiProperty({ description: 'E-mail de quem vai receber o ambiente' })
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(254)
  targetEmail: string;

  @ApiProperty({
    description: 'Quem envia declara que perderá o acesso ao ambiente',
  })
  @Equals(true, {
    message:
      'Confirme que você entende que perderá o acesso a este ambiente por completo.',
  })
  confirmLossOfAccess: boolean;
}

/**
 * O token do convite viaja no corpo, nunca no caminho: endereço de
 * requisição vai parar em log, e o token abre a conta inteira.
 */
export class InviteTokenDto {
  @ApiProperty()
  @IsString()
  @Length(20, 200, { message: 'Convite inválido.' })
  token: string;
}

export class InviteCompanyDto extends InviteTokenDto {
  @ApiProperty()
  @IsCnpj({ message: 'CNPJ inválido.' })
  cnpj: string;
}

export class InviteRepresentativeCheckDto extends InviteTokenDto {
  @ApiProperty()
  @IsCnpj({ message: 'CNPJ inválido.' })
  cnpj: string;

  @ApiProperty()
  @IsCpf({ message: 'CPF inválido.' })
  cpf: string;
}

export class TransferCompanyDto {
  @ApiProperty()
  @IsCnpj({ message: 'CNPJ inválido.' })
  cnpj: string;

  @ApiProperty({
    required: false,
    description: 'Razão social, quando a consulta de CNPJ não a trouxer',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tradeName?: string;
}

/**
 * O aceite cria a conta nova e efetiva a transferência num pedido só. O
 * e-mail não vem daqui: é o do convite, e trocá-lo faria o link valer para
 * quem o recebesse encaminhado.
 */
export class AcceptOwnershipTransferDto extends InviteTokenDto {
  @ApiProperty({ description: 'Nome de quem cria a conta' })
  @IsString()
  @MinLength(2, { message: 'Informe o seu nome.' })
  @MaxLength(120)
  name: string;

  @ApiProperty({ description: 'Senha da conta nova (as cinco regras)' })
  @IsString()
  @MaxLength(128)
  password: string;

  @ApiProperty({ type: TransferCompanyDto })
  @ValidateNested()
  @Type(() => TransferCompanyDto)
  company: TransferCompanyDto;

  @ApiProperty({ type: CheckoutRepresentativeDto })
  @ValidateNested()
  @Type(() => CheckoutRepresentativeDto)
  representative: CheckoutRepresentativeDto;

  @ApiProperty({ type: CheckoutTermsDto })
  @ValidateNested()
  @Type(() => CheckoutTermsDto)
  termsAcceptance: CheckoutTermsDto;
}
