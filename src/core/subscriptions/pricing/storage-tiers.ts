import { UnprocessableEntityException } from '@nestjs/common';

/**
 * As faixas de espaço dos arquivos de produção (GP-48 item 27) são
 * complementos com `storageGb`; a assinatura tem uma só. Contratar outra
 * troca a faixa (nos complementos); na contratação nova, escolher duas é
 * erro.
 */
/** O complemento é uma faixa de espaço. */
export const isStorageTier = (feature: { storageGb?: number | null }) =>
  (feature.storageGb ?? 0) > 0;

export function assertSingleStorageTier(
  features: { storageGb?: number | null }[],
) {
  if (features.filter(isStorageTier).length > 1) {
    throw new UnprocessableEntityException({
      code: 'STORAGE_TIER_SINGLE',
      message: 'Escolha uma faixa de espaço dos arquivos de produção só.',
    });
  }
}

/** O tamanho para a mensagem: GB com uma casa, ou MB abaixo de 1 GB. */
export function formatBytes(bytes: number) {
  const gb = bytes / 1024 ** 3;
  return gb >= 1
    ? `${gb.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`
    : `${Math.ceil(bytes / 1024 ** 2).toLocaleString('pt-BR')} MB`;
}
