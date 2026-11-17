import { TransformFnParams } from 'class-transformer';

/**
 * Texto da proposta comercial próprio da série.
 *
 * Em branco, a série volta a usar o texto da empresa: grava null em vez de ''.
 * O texto preenchido fica como foi digitado.
 */
export const blankProposalTextToNull = ({ value }: TransformFnParams) =>
  typeof value === 'string' && value.trim() === '' ? null : value;
