// Motivos de rejeição e de cancelamento (revisão do produto, 24/10/2026):
// listas que viram relatório de perdas por motivo
export const BASE_REASONS = [
  { reason: 'Preço acima do esperado', type: 'REJECTION' },
  { reason: 'Prazo de entrega', type: 'REJECTION' },
  { reason: 'Fechou com concorrente', type: 'REJECTION' },
  { reason: 'Adiou o projeto', type: 'REJECTION' },
  { reason: 'Sem retorno do cliente', type: 'REJECTION' },
  { reason: 'Outro', type: 'REJECTION' },
  { reason: 'Cliente desistiu', type: 'CANCELLATION' },
  { reason: 'Erro no orçamento', type: 'CANCELLATION' },
  { reason: 'Erro de produção', type: 'CANCELLATION' },
  { reason: 'Falta de material', type: 'CANCELLATION' },
  { reason: 'Outro', type: 'CANCELLATION' },
];

// Marcadores de acompanhamento comercial (24/10/2026): informação a mais
// sobre o status do sistema (Digitação, Aguardando, Aprovado, Rejeitado,
// Vencido), nunca uma cópia dele
export const BASE_QUOTATION_TAGS = [
  { title: 'Proposta enviada', color: '#1570EF' },
  { title: 'Em negociação', color: '#F79009' },
  { title: 'Aguardando retorno do cliente', color: '#7A5AF8' },
  { title: 'Revisar proposta', color: '#D92D20' },
];
