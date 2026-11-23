/**
 * A tarefa da produção vista pela baixa no lote (ES-16): o setor, a venda e
 * o consumo da etapa. O consumo guarda o material vendido como
 * `material:<id>[:<variação>]` (as tarefas antigas, sem ele, não sabem).
 */
export type LotTask = {
  id: string;
  code: string;
  sectorId: string | null;
  stageName: string;
  quotationId: string;
  number: string;
  consumption: unknown;
};

export type SoldMaterial = {
  /** material|variação, como o saldo do estoque */
  key: string;
  materialId: string;
  variationId: string | null;
  name: string;
  quantity: number | null;
  unit: string;
};

/** Os materiais vendidos na etapa, sem repetir. */
export function soldMaterials(consumption: unknown): SoldMaterial[] {
  const lines = Array.isArray(consumption) ? consumption : [];
  const result = new Map<string, SoldMaterial>();
  for (const line of lines) {
    const match = /^material:([^:]+)(?::(.+))?$/.exec(
      String(line?.resourceId ?? ''),
    );
    if (!match) continue;
    const key = `${match[1]}|${match[2] ?? ''}`;
    const current = result.get(key);
    const quantity = typeof line.quantity === 'number' ? line.quantity : null;
    result.set(key, {
      key,
      materialId: match[1],
      variationId: match[2] ?? null,
      name: String(line.resource ?? ''),
      quantity:
        current && current.quantity !== null && quantity !== null
          ? current.quantity + quantity
          : (quantity ?? current?.quantity ?? null),
      unit: String(line.unit ?? ''),
    });
  }
  return [...result.values()];
}
