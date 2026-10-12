import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AbacService } from './abac.service';
import { MONEY_FIELDS_KEY, VALUES_ONLY_KEY } from './money-fields.decorator';
import { permissionDenied } from './permissions.guard';

export const VALUES_PERMISSION = 'values:values:view';

const CAN_VIEW_VALUES = Symbol('canViewValues');

/** O mesmo aviso (método, rota, cargo e campos) sai no máximo uma vez por janela. */
const WARN_WINDOW_MS = 10 * 60 * 1000;
const MAX_WARN_KEYS = 1_000;

export type ValuesRule = { valuesOnly: true } | { fields: Set<string> };

export function valuesVisibilityEnforced(): boolean {
  return process.env.VALUES_VISIBILITY_ENFORCE === 'true';
}

/**
 * A marca de valores de uma rota. A da rota vale sobre a da classe, qualquer
 * que seja o decorator.
 */
export function valuesRuleOf(
  handler: object,
  controller: object,
): ValuesRule | null {
  for (const target of [handler, controller]) {
    const fields: string[] | undefined = Reflect.getMetadata(
      MONEY_FIELDS_KEY,
      target,
    );
    if (fields?.length) return { fields: new Set(fields) };

    const valuesOnly: boolean | undefined = Reflect.getMetadata(
      VALUES_ONLY_KEY,
      target,
    );
    if (valuesOnly !== undefined) {
      return valuesOnly ? { valuesOnly: true } : null;
    }
  }
  return null;
}

/**
 * A permissão `values:values:view` do usuário, resolvida uma vez por
 * requisição. É a fonte única: o interceptor das rotas antigas pergunta
 * aqui, e os grupos de serialização das rotas novas devem perguntar também.
 */
export function canViewValues(
  request: any,
  abacService: AbacService,
): Promise<boolean> {
  if (request[CAN_VIEW_VALUES] === undefined) {
    request[CAN_VIEW_VALUES] = request.user
      ? abacService.hasPermission(request.user, 'view', 'values:values')
      : Promise.resolve(false);
  }
  return request[CAN_VIEW_VALUES];
}

function isMoney(value: unknown): boolean {
  return (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    Prisma.Decimal.isDecimal(value)
  );
}

// Só listas e objetos de dados são percorridos. Data, Decimal, buffer,
// arquivo (stream) e coleções passam como estão
function isContainer(value: unknown): value is object {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return true;
  return !(
    value instanceof Date ||
    value instanceof Map ||
    value instanceof Set ||
    ArrayBuffer.isView(value) ||
    Prisma.Decimal.isDecimal(value) ||
    typeof (value as { pipe?: unknown }).pipe === 'function' ||
    typeof (value as { getStream?: unknown }).getStream === 'function'
  );
}

/**
 * Os campos de dinheiro presentes na resposta (com número), em ordem
 * alfabética.
 */
export function findMoneyFields(body: unknown, fields: Set<string>): string[] {
  const found = new Set<string>();
  const seen = new WeakSet<object>();

  const visit = (value: unknown) => {
    if (!isContainer(value) || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (fields.has(key) && isMoney(child)) found.add(key);
      else visit(child);
    }
  };

  visit(body);
  return [...found].sort();
}

/**
 * Cópia da resposta sem os campos de dinheiro. Nunca altera o original: o
 * mesmo objeto pode estar num cache e servir a quem tem a permissão.
 */
export function omitMoneyFields<T>(body: T, fields: Set<string>): T {
  const copies = new WeakMap<object, unknown>();

  const prune = (value: unknown): unknown => {
    if (!isContainer(value)) return value;
    if (copies.has(value)) return copies.get(value);

    if (Array.isArray(value)) {
      const copy: unknown[] = [];
      copies.set(value, copy);
      for (const item of value) copy.push(prune(item));
      return copy;
    }

    const copy = Object.create(Object.getPrototypeOf(value));
    copies.set(value, copy);
    for (const [key, child] of Object.entries(value)) {
      if (fields.has(key) && isMoney(child)) continue;
      copy[key] = prune(child);
    }
    return copy;
  };

  return prune(body) as T;
}

/**
 * Dinheiro só para quem tem `values:values:view`, nas rotas marcadas com
 * @MoneyFields (omite os campos) ou @ValuesOnly (recusa a rota).
 *
 * Por padrão só observa: registra no log o que sairia da resposta ou a recusa
 * que faria, sem mudar nada. Omitir agora quebraria a venda de quem não tem a
 * permissão: ao incluir um produto no orçamento, a tela manda de volta o
 * preço que recebeu e o servidor grava o que vier (sem preço, grava zero).
 * Com VALUES_VISIBILITY_ENFORCE=true passa a omitir e a recusar.
 */
@Injectable()
export class ValuesVisibilityInterceptor implements NestInterceptor {
  private readonly logger = new Logger('ValuesVisibility');
  private readonly warnedAt = new Map<string, number>();

  constructor(private readonly abacService: AbacService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();

    const rule = valuesRuleOf(context.getHandler(), context.getClass());
    if (!rule) return next.handle();

    const request = context.switchToHttp().getRequest();
    // Rota sem usuário autenticado não tem permissão a conferir
    if (!request.user) return next.handle();
    if (await canViewValues(request, this.abacService)) return next.handle();

    if ('valuesOnly' in rule) {
      if (valuesVisibilityEnforced()) {
        throw permissionDenied([VALUES_PERMISSION]);
      }
      this.warnOnce(request, 'seria recusada');
      return next.handle();
    }

    return next.handle().pipe(
      map((body) => {
        if (valuesVisibilityEnforced()) {
          return omitMoneyFields(body, rule.fields);
        }
        const found = findMoneyFields(body, rule.fields);
        if (found.length) {
          this.warnOnce(request, `sairia sem ${found.join(', ')}`);
        }
        return body;
      }),
    );
  }

  private warnOnce(request: any, what: string) {
    const user = request.user;
    const route = `${request.method} ${request.route?.path ?? request.url}`;
    const key = `${route} ${user.role ?? '-'} ${what}`;

    const now = Date.now();
    const last = this.warnedAt.get(key);
    if (last !== undefined && now - last < WARN_WINDOW_MS) return;
    if (this.warnedAt.size >= MAX_WARN_KEYS) this.warnedAt.clear();
    this.warnedAt.set(key, now);

    this.logger.warn(
      `[observar] ${route} ${what}: usuário ${user.userId ?? '?'}, ` +
        `empresa ${user.companyId ?? '?'}, cargo ${user.role ?? '-'}, ` +
        `falta ${VALUES_PERMISSION}`,
    );
  }
}
