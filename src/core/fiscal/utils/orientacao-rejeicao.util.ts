/**
 * Orientação para recusas cuja providência está FORA da nota: habilitação na
 * SEFAZ, licença no provedor fiscal, CSC cadastrado na SEFAZ.
 *
 * O texto cru da autorizadora ("Rejeicao: Emissor nao habilitado para emissao
 * da NF-e/NFC-e") não diz a quem recorrer, e quem o lê tende a achar que o
 * sistema falhou. Foi o que aconteceu em 23/10/2026: o emissor estava
 * configurado e a nota chegou à SEFAZ, mas o contribuinte não estava
 * habilitado para NFC-e — embora o portal mostrasse um CSC "Ativo".
 *
 * A orientação vai gravada junto do motivo, depois de uma linha em branco e
 * começando por MARCADOR_ORIENTACAO. Assim qualquer tela que mostre o motivo
 * já mostra o que fazer, e o modal de motivo destaca o parágrafo.
 *
 * Lista curada de propósito: só códigos cuja causa conhecemos e cuja
 * providência não está nos dados da nota. Sem entrada, nada é acrescentado.
 */

export const MARCADOR_ORIENTACAO = 'O que fazer';

type Modelo = 'NF-e' | 'NFC-e';

interface Entrada {
  /** Quem resolve, no cabeçalho do parágrafo. */
  onde: string;
  texto: (modelo: Modelo) => string;
  /** Só vale para estes modelos; ausente vale para todos. */
  modelos?: Modelo[];
}

const HABILITACAO_SEFAZ: Entrada = {
  onde: 'habilitação na SEFAZ, fora do Atrupe',
  texto: (modelo) =>
    `a nota foi transmitida pelo Atrupe e a SEFAZ informou que este CNPJ/IE ` +
    `não está habilitado para emitir ${modelo}. A habilitação (credenciamento) ` +
    'é feita na Secretaria da Fazenda do estado, normalmente pelo contador.' +
    (modelo === 'NFC-e'
      ? ' Ter um CSC ativo no portal da SEFAZ não basta: o contribuinte também' +
        ' precisa estar habilitado para NFC-e.'
      : '') +
    ' Depois de habilitado, emita de novo.',
};

const CSC_RECUSADO: Entrada = {
  onde: 'CSC da NFC-e',
  modelos: ['NFC-e'],
  texto: () =>
    'a SEFAZ não aceitou o CSC usado no QR Code. Confira no portal da SEFAZ o ' +
    'identificador e o código do CSC ativo no ambiente desta nota, salve-os no ' +
    'emissor (Configurações > Emissores) e ative a NFC-e de novo: a ativação ' +
    'envia o CSC ao provedor fiscal.',
};

/** cStat da SEFAZ (Situacao.SitCodigo). */
const SEFAZ: Record<number, Entrada> = {
  203: HABILITACAO_SEFAZ,
  // A NFC-e tem código próprio para a falta de credenciamento. A SVRS manda o
  // mesmo texto do 203 ("...NF-e/NFC-e"), e foi o 781 que veio nas NFC-e da
  // Atrupe em 23/10 e 29/10/2026: com só o 203 na tabela, a orientação sumia.
  781: HABILITACAO_SEFAZ,
  301: {
    onde: 'situação cadastral na SEFAZ, fora do Atrupe',
    texto: () =>
      'a SEFAZ denegou a nota por irregularidade fiscal do emitente. A ' +
      'situação cadastral da empresa precisa ser regularizada na Secretaria da ' +
      'Fazenda, normalmente pelo contador. A nota denegada fica registrada na ' +
      'SEFAZ com este número.',
  },
  462: CSC_RECUSADO, // Identificador do CSC no QR Code não cadastrado na SEFAZ
  463: CSC_RECUSADO, // Identificador do CSC no QR Code revogado pela empresa
  464: CSC_RECUSADO, // Hash do QR Code difere do calculado
};

/**
 * Código de lote do provedor (Codigo ≠ 100). O 607 foi confirmado em produção:
 * em 16/10 e 23/10/2026 ele veio para CNPJs sem o módulo no `Licenciamento` do
 * cadastro no Invoicy, e deixou de vir quando o módulo foi incluído.
 */
const PROVEDOR: Record<number, Entrada> = {
  607: {
    onde: 'licença no provedor fiscal',
    texto: (modelo) =>
      'nada foi enviado à SEFAZ. O provedor fiscal (Invoicy) informou que a ' +
      `licença deste CNPJ para emitir ${modelo} não está ativa; não é falha ` +
      'na nota nem no Atrupe. Peça ao suporte da Atrupe a reativação da ' +
      'licença no provedor e emita de novo.',
  },
};

/**
 * Parágrafo de orientação para a recusa, ou null quando o código não está na
 * lista. `codigo` aceita string porque o provedor às vezes manda número como
 * texto.
 */
export function orientacaoRejeicaoFiscal(params: {
  origem: 'SEFAZ' | 'PROVEDOR';
  codigo?: number | string | null;
  modelo: Modelo;
}): string | null {
  const codigo = Number(params.codigo);
  if (!Number.isFinite(codigo)) return null;

  const tabela = params.origem === 'SEFAZ' ? SEFAZ : PROVEDOR;
  const entrada = tabela[codigo];
  if (!entrada) return null;
  if (entrada.modelos && !entrada.modelos.includes(params.modelo)) return null;

  return `${MARCADOR_ORIENTACAO} (${entrada.onde}): ${entrada.texto(params.modelo)}`;
}

/**
 * Motivo a gravar: o retorno da autorizadora/provedor e, se houver, a
 * orientação depois de uma linha em branco — o separador que o modal procura.
 */
export function motivoComOrientacao(
  motivo: string | null | undefined,
  orientacao: string | null,
): string | null {
  if (!orientacao) return motivo ?? null;
  return motivo ? `${motivo}\n\n${orientacao}` : orientacao;
}

/**
 * Mensagem de erro (toast) com a orientação na mesma linha: o toast não
 * preserva quebras de linha.
 */
export function mensagemComOrientacao(
  mensagem: string,
  orientacao: string | null,
): string {
  if (!orientacao) return mensagem;
  return `${mensagem.replace(/[\s.]+$/, '')}. ${orientacao}`;
}
