import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export function IsCpf(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isCpf',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: CpfConstraint,
    });
  };
}

@ValidatorConstraint({ name: 'isCpf', async: false })
class CpfConstraint implements ValidatorConstraintInterface {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  validate(cpf: string, args: ValidationArguments) {
    return validCPF(cpf);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  defaultMessage(args: ValidationArguments) {
    return 'CPF is not valid';
  }
}

/****************************************************************************************/
/* VALIDATE CPF                                                                         */
/****************************************************************************************/
export const validCPF = (value: string | number | number[] = '') => {
  if (!value) return false;

  // Convert to string
  const stringValue = typeof value === 'string' ? value : String(value);

  // Remove all non-digit characters
  const cleanCPF = stringValue.replace(/[^\d]/g, '');

  // Check if CPF has 11 digits
  if (cleanCPF.length !== 11) return false;

  // Check if all digits are equal
  const items = [...new Set(cleanCPF)];
  if (items.length === 1) return false;

  // Calculate the digits
  const digit0 = validCalcCPF(9, cleanCPF);
  const digit1 = validCalcCPF(10, cleanCPF);

  return digit0 === parseInt(cleanCPF[9]) && digit1 === parseInt(cleanCPF[10]);
};

function validCalcCPF(length: number, cpf: string): number {
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += parseInt(cpf[i]) * (length + 1 - i);
  }
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}
