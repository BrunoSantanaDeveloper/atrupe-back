/**
 * Representante legal da empresa contratante: quem responde legalmente por
 * ela, e em nome de quem o contrato é aceito.
 *
 * Portado de prototype/packages/dominio/src/representantes.ts.
 *
 * O problema que este módulo resolve é o formato do quadro societário na base
 * pública: os nomes vêm inteiros, e os CPFs MASCARADOS (`***487787**`, só os
 * dígitos 4 a 9 à mostra). Um documento pela metade não identifica ninguém,
 * então a verificação não é "escolha um nome desta lista": é o contrário. A
 * pessoa informa o CPF inteiro e ele é conferido contra a máscara publicada.
 *
 * Puro: recebe o quadro e o CPF, devolve o veredito.
 */

export interface RegistryPartner {
  name: string;
  /** Texto da qualificação, como a Receita publica ("Sócio-Administrador"). */
  qualification: string;
  /** Código da qualificação na tabela da Receita, quando o texto não vem. */
  qualificationCode?: number | null;
  /** CPF mascarado: `***487787**`. */
  maskedDocument: string;
}

/**
 * Termos de qualificação que carregam poder de administrar a empresa. É lista
 * de termos, não de rótulos inteiros, porque a base publica variações do mesmo
 * cargo ("Diretor Presidente", "Administrador Judicial").
 *
 * `sócio` sozinho NÃO entra: sócio quotista sem administração não obriga a
 * empresa — é justamente a distinção entre quem assina e quem só tem capital.
 */
const ADMINISTRATION_TERMS = [
  'administrador',
  'administradora',
  'diretor',
  'diretora',
  'presidente',
  'titular',
  'proprietario',
  'proprietaria',
  'empresario',
  'empresaria',
];

/**
 * Códigos da tabela de qualificação da Receita com poder de administração,
 * usados só quando o texto da qualificação não vem na resposta: 05
 * Administrador, 10 Diretor, 16 Presidente, 49 Sócio-Administrador, 50
 * Empresário, 65 Titular Pessoa Física residente no Brasil.
 */
const ADMINISTRATION_CODES = new Set([5, 10, 16, 49, 50, 65]);

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Tem poder de administrar a empresa, pela qualificação publicada. */
export function hasAdministrationPower(partner: RegistryPartner): boolean {
  const text = normalize(partner.qualification ?? '');
  if (text) return ADMINISTRATION_TERMS.some((term) => text.includes(term));
  return ADMINISTRATION_CODES.has(Number(partner.qualificationCode));
}

/** Os sócios do quadro que podem responder pela empresa. */
export function administratorsOf(
  partners: RegistryPartner[],
): RegistryPartner[] {
  return partners.filter(hasAdministrationPower);
}

/**
 * O CPF informado bate com o documento mascarado do registro.
 *
 * Compara só os dígitos à mostra — é o máximo que a base permite, e é
 * bastante: seis dígitos consecutivos de um CPF não se acertam por acaso.
 * Máscara vazia ou fora do formato devolve false: sem dígitos publicados não
 * há o que conferir, e responder true transformaria ausência de dado em
 * confirmação.
 */
export function cpfMatchesMask(cpf: string, maskedDocument: string): boolean {
  const digits = String(cpf ?? '').replace(/\D/g, '');
  const mask = String(maskedDocument ?? '').trim();
  if (digits.length !== 11 || mask.length !== 11) return false;
  const visible = [...mask]
    .map((char, position) => ({ char, position }))
    .filter(({ char }) => /\d/.test(char));
  if (visible.length === 0) return false;
  return visible.every(({ char, position }) => digits[position] === char);
}

/**
 * O quadro permite conferir? Sem nenhum administrador com CPF publicado, não:
 * aí o CPF é aceito sem conferência, porque uma falha da base pública não
 * pode impedir a contratação — e o aceite registra que não houve conferência.
 */
export function registryAllowsVerification(
  partners: RegistryPartner[],
): boolean {
  return administratorsOf(partners).some(
    (p) => String(p.maskedDocument ?? '').trim().length === 11,
  );
}

export type RepresentativeVerdict =
  /** O CPF é de um administrador do quadro; o nome é o que o registro publica. */
  | { status: 'VERIFIED'; name: string; qualification: string }
  /** Há quadro para conferir, e o CPF não é de nenhum administrador: bloqueia o aceite. */
  | { status: 'NOT_IN_REGISTRY' }
  /** Não há quadro para conferir: aceita sem conferência e pede o nome. */
  | { status: 'UNVERIFIABLE' };

export function verifyRepresentative(
  partners: RegistryPartner[],
  cpf: string,
): RepresentativeVerdict {
  if (!registryAllowsVerification(partners)) return { status: 'UNVERIFIABLE' };
  const match = administratorsOf(partners).find((p) =>
    cpfMatchesMask(cpf, p.maskedDocument),
  );
  if (!match) return { status: 'NOT_IN_REGISTRY' };
  return {
    status: 'VERIFIED',
    name: match.name,
    qualification: match.qualification,
  };
}
