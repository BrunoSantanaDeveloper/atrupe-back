import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import {
  validateCnae,
  validateCodigoServico,
} from '../../core/fiscal/utils/fiscal-validators';

/**
 * Valida CNAE (7 dígitos, com ou sem máscara). Campo opcional: vazio passa,
 * quem valida obrigatoriedade é o @IsNotEmpty de quem usa.
 *
 * Existe porque o campo era texto livre e a base acumulou lixo — um cadastro
 * com endereço de e-mail e outros com código da LC 116 no lugar do CNAE.
 */
export function IsCnae(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isCnae',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: CnaeConstraint,
    });
  };
}

@ValidatorConstraint({ name: 'isCnae', async: false })
class CnaeConstraint implements ValidatorConstraintInterface {
  validate(cnae: string) {
    if (cnae === undefined || cnae === null || cnae === '') return true;
    return validateCnae(cnae).valid;
  }

  defaultMessage(args: ValidationArguments) {
    return validateCnae(args.value).message || 'CNAE inválido';
  }
}

/**
 * Valida o código da lista de serviços da LC 116/2003 (formato 00.00).
 * Campo opcional: vazio passa.
 */
export function IsCodigoServico(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isCodigoServico',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: CodigoServicoConstraint,
    });
  };
}

@ValidatorConstraint({ name: 'isCodigoServico', async: false })
class CodigoServicoConstraint implements ValidatorConstraintInterface {
  validate(codigo: string) {
    if (codigo === undefined || codigo === null || codigo === '') return true;
    return validateCodigoServico(codigo).valid;
  }

  defaultMessage(args: ValidationArguments) {
    return (
      validateCodigoServico(args.value).message || 'Código do serviço inválido'
    );
  }
}
