import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/** Teto de itens por página. */
export const PAGE_LIMIT_MAX = 100;

const LIMIT_PARAMS = ['limit', 'pageSize', 'perPage'] as const;

/**
 * Rotas do superadmin que listam a base inteira de propósito (migração,
 * histórico de acessos). O middleware não enxerga o handler, então a exceção
 * é por prefixo.
 */
const EXEMPT_PREFIXES = [
  '/migration',
  '/subscriptions/admin',
  '/activity-monitor',
];

/** O mesmo aviso (método, rota e parâmetro) sai no máximo uma vez por janela. */
const WARN_WINDOW_MS = 10 * 60 * 1000;
const MAX_WARN_KEYS = 1_000;

export function pageLimitEnforced(): boolean {
  return process.env.PAGE_LIMIT_ENFORCE === 'true';
}

/**
 * Teto de paginação transversal: vale para os DTOs que estendem o
 * BaseFilterDTO, para os que têm `limit` próprio e para o `@Query` cru.
 *
 * Por padrão só observa: registra no log o pedido acima do teto, sem mudar
 * nada. O front pede `perPage: 9999` em várias listas de seleção, e cortar
 * agora deixaria essas listas incompletas. Com PAGE_LIMIT_ENFORCE=true, troca
 * o valor pelo teto (não recusa o pedido).
 */
@Injectable()
export class PageLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger('PageLimit');
  private readonly warnedAt = new Map<string, number>();

  use(req: Request, _res: Response, next: NextFunction) {
    const path = (req.originalUrl || req.url || '').split('?')[0];
    if (EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return next();
    }

    const query = (req.query ?? {}) as Record<string, unknown>;
    for (const param of LIMIT_PARAMS) {
      const raw = query[param];
      if (typeof raw !== 'string') continue;
      const value = Number.parseInt(raw, 10);
      if (!Number.isFinite(value) || value <= PAGE_LIMIT_MAX) continue;

      if (pageLimitEnforced()) {
        query[param] = String(PAGE_LIMIT_MAX);
      } else {
        this.warnOnce(
          `${req.method} ${path} ${param}`,
          `[observar] ${req.method} ${path} pede ${param}=${raw}, acima do teto de ${PAGE_LIMIT_MAX}`,
        );
      }
    }
    next();
  }

  private warnOnce(key: string, message: string) {
    const now = Date.now();
    const last = this.warnedAt.get(key);
    if (last !== undefined && now - last < WARN_WINDOW_MS) return;
    if (this.warnedAt.size >= MAX_WARN_KEYS) this.warnedAt.clear();
    this.warnedAt.set(key, now);
    this.logger.warn(message);
  }
}
