import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export function IsCnpj(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isCnpj',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: CnpjConstraint,
    });
  };
}

@ValidatorConstraint({ name: 'isCnpj', async: false })
class CnpjConstraint implements ValidatorConstraintInterface {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  validate(cnpj: string, args: ValidationArguments) {
    return validCNPJ(cnpj);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  defaultMessage(args: ValidationArguments) {
    return 'CNPJ is not valid';
  }
}

/****************************************************************************************/
/* VALIDATE CNPJ                                                                        */
/****************************************************************************************/

export const validCNPJ = (value: string | number | number[] = '') => {
  if (!value) return false;

  // Convert to string
  const stringValue = typeof value === 'string' ? value : String(value);

  // Remove all non-digit characters
  const cleanCNPJ = stringValue.replace(/[^\d]/g, '');

  // Check if CNPJ has 14 digits
  if (cleanCNPJ.length !== 14) return false;

  // Check if all digits are equal
  const items = [...new Set(cleanCNPJ)];
  if (items.length === 1) return false;

  // Calculate the digits
  const digit0 = validCalc(12, cleanCNPJ);
  const digit1 = validCalc(13, cleanCNPJ);

  return (
    digit0 === parseInt(cleanCNPJ[12]) && digit1 === parseInt(cleanCNPJ[13])
  );
};

// Calculate the digits
// @input length: number
// @input cnpj: string
// @output number
function validCalc(length: number, cnpj: string): number {
  let sum = 0;
  let weight = length - 7;
  for (let i = 0; i < length; i++) {
    sum += parseInt(cnpj[i]) * weight--;
    if (weight < 2) weight = 9;
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}
