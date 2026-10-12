import { NotFoundException } from '@nestjs/common';

type CountDelegate = { count(args: { where: any }): Promise<number> };

type MaybeIds = string | null | undefined | (string | null | undefined)[];

/**
 * Confere que os ids são de registros da empresa da sessão.
 *
 * Serve aos ids que chegam no corpo da requisição (fornecedor, conta
 * bancária, condição de pagamento, cargo...): sem a conferência, um id de
 * outra empresa ligava o registro dela ao desta. `scope` é o filtro da
 * empresa no model: `{ companyId }` quando ele tem a coluna, ou pela relação
 * (`{ client: { companyId } }`). Ids vazios são ignorados; id de outra
 * empresa responde 404, como um id que não existe.
 */
export async function assertBelongsToCompany(
  delegate: CountDelegate,
  ids: MaybeIds,
  scope: Record<string, unknown>,
  notFoundMessage: string,
): Promise<void> {
  const list = Array.from(
    new Set(
      (Array.isArray(ids) ? ids : [ids]).filter(
        (id): id is string => typeof id === 'string' && id !== '',
      ),
    ),
  );
  if (!list.length) return;

  const found = await delegate.count({
    where: { id: { in: list }, ...scope },
  });
  if (found !== list.length) {
    throw new NotFoundException(notFoundMessage);
  }
}
