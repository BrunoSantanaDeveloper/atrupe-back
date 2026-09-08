/**
 * Prazo para cancelar uma NF-e, contado da AUTORIZAÇÃO DE USO.
 *
 * O Ajuste SINIEF fixa 24 horas como prazo regular em âmbito nacional, mas
 * quem valida é a SEFAZ autorizadora de cada UF, e várias recebem o evento
 * fora desse prazo — o chamado cancelamento extemporâneo, que é aceito e
 * sujeita o emitente a penalidade. São Paulo aceita até 480 horas; há estados
 * documentados em 720 e 1440 horas.
 *
 * Por que não existe aqui uma tabela de prazos "oficial" por UF: as tabelas
 * publicadas por provedores e consultorias **divergem entre si** para os
 * mesmos estados (Mato Grosso aparece como 2 e como 8 horas; Minas Gerais
 * como 24 e como 168). Fixar um desses números como verdade faria o sistema
 * bloquear um cancelamento que a SEFAZ aceitaria — exatamente o problema que
 * este módulo existe para evitar.
 *
 * A escolha, então, é assimétrica de propósito:
 *
 * - **Bloquear cedo é o erro caro**: a nota fica sem poder ser cancelada pelo
 *   sistema e o usuário precisa recorrer à SEFAZ.
 * - **Tentar e ser recusado é barato**: a SEFAZ devolve a rejeição 501 e nada
 *   acontece com a nota.
 *
 * Então o limite local é generoso (o teto conhecido do país) e a autoridade
 * final é a SEFAZ. Entre o prazo regular e o limite, a emissão segue, mas o
 * usuário é avisado de que está fora do prazo regular e pode haver multa.
 */

/** Prazo regular nacional, contado da autorização de uso. */
export const PRAZO_REGULAR_HORAS = 24;

/**
 * Teto local, em horas. Acima disso o cancelamento por evento não é aceito por
 * nenhuma UF conhecida e só resta o pedido formal à SEFAZ — 60 dias é o maior
 * prazo documentado (Piauí).
 */
export const LIMITE_MAXIMO_HORAS = 1440;

export interface AvaliacaoPrazoCancelamento {
  /** Horas decorridas desde a autorização de uso. */
  horasDecorridas: number;
  /** Limite aplicado nesta avaliação. */
  limiteHoras: number;
  /** Dentro das 24 horas: cancelamento comum, sem penalidade. */
  dentroDoPrazoRegular: boolean;
  /** Vale tentar transmitir; a SEFAZ dá a palavra final. */
  podeTentar: boolean;
  /** Texto para o usuário quando está fora do prazo regular. */
  aviso?: string;
  /** Texto do bloqueio quando nem vale tentar. */
  bloqueio?: string;
}

export function avaliarPrazoCancelamento(params: {
  /** Autorização de uso; a emissão só serve de fallback para nota antiga. */
  autorizadaEm?: Date | null;
  emitidaEm?: Date | null;
  /** Limite configurado no emissor, em horas. Ausente usa o teto. */
  limiteConfiguradoHoras?: number | null;
  agora?: Date;
}): AvaliacaoPrazoCancelamento {
  const referencia = params.autorizadaEm ?? params.emitidaEm ?? null;
  const limiteHoras = params.limiteConfiguradoHoras ?? LIMITE_MAXIMO_HORAS;

  // Sem data de referência não dá para medir prazo nenhum. Deixar passar é o
  // certo: a SEFAZ sabe a data real da autorização e decide.
  if (!referencia) {
    return {
      horasDecorridas: 0,
      limiteHoras,
      dentroDoPrazoRegular: false,
      podeTentar: true,
      aviso:
        'A nota não tem data de autorização registrada, então o prazo não pôde ser conferido aqui. A SEFAZ vai validar no envio.',
    };
  }

  const agora = params.agora ?? new Date();
  const horasDecorridas =
    (agora.getTime() - referencia.getTime()) / (1000 * 60 * 60);

  if (horasDecorridas <= PRAZO_REGULAR_HORAS) {
    return {
      horasDecorridas,
      limiteHoras,
      dentroDoPrazoRegular: true,
      podeTentar: true,
    };
  }

  const dias = Math.floor(horasDecorridas / 24);
  const decorridoTexto =
    dias >= 1
      ? `${dias} dia${dias === 1 ? '' : 's'}`
      : `${Math.floor(horasDecorridas)} horas`;

  if (horasDecorridas > limiteHoras) {
    return {
      horasDecorridas,
      limiteHoras,
      dentroDoPrazoRegular: false,
      podeTentar: false,
      bloqueio:
        `A nota foi autorizada há ${decorridoTexto} e o cancelamento por evento ` +
        `não é mais aceito (limite de ${limiteHoras} horas). ` +
        'Para cancelar, é preciso pedido formal à SEFAZ do estado do emitente.',
    };
  }

  return {
    horasDecorridas,
    limiteHoras,
    dentroDoPrazoRegular: false,
    podeTentar: true,
    aviso:
      `A nota foi autorizada há ${decorridoTexto}, fora do prazo regular de ` +
      `${PRAZO_REGULAR_HORAS} horas. Alguns estados aceitam o cancelamento ` +
      'extemporâneo com penalidade, e outros recusam. O envio será feito e a ' +
      'SEFAZ dá a palavra final.',
  };
}

/**
 * Orientação para as rejeições de cancelamento que o texto da SEFAZ não
 * explica. Mesma curadoria de `getRejectionHint` da emissão: só entra código
 * cuja orientação acrescenta algo ao `xMotivo`.
 */
export function orientacaoRejeicaoCancelamento(
  sitCodigo?: number,
): string | null {
  const hints: Record<number, string> = {
    501:
      'a SEFAZ do estado não aceita o cancelamento neste prazo. ' +
      'Cancelamento fora do prazo depende de pedido formal ao posto fiscal; ' +
      'se a mercadoria não circulou, avalie emitir uma nota de devolução.',
    // A nota já foi cancelada: normalmente uma segunda tentativa do usuário.
    218: 'esta nota já consta como cancelada na SEFAZ. Consulte a situação dela para atualizar o sistema.',
    // Documento não autorizado: cancelar não se aplica.
    217: 'a SEFAZ não encontrou esta nota. Confira se ela chegou a ser autorizada.',
  };

  return hints[sitCodigo ?? -1] ?? null;
}
