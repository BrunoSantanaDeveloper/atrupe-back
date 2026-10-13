/**
 * A parte do rateio do setor que cabe a um bem no mês (BC-3): quem calcula
 * é a base de custos. O patrimônio só lê, por este contrato, para o custo
 * por unidade das configurações bater com o da precificação.
 */
export const ASSET_POOL = 'ASSET_POOL';

export interface AssetPool {
  poolOf(companyId: string, assetId: string): Promise<number>;
}
