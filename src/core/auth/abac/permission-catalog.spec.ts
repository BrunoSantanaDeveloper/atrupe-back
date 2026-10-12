import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { HAS_PERMISSION_KEY } from './has-permission.decorator';
import { HAS_ANY_PERMISSION_KEY } from './has-any-permission.decorator';
import {
  PERMISSION_ACTIONS,
  isCatalogResource,
  isKnownPermission,
  isKnownResource,
} from './permission-catalog';
import { CATEGORY_KIND_PERMISSION } from '../../category/category.controller';

/**
 * Toda chave usada para conferir permissão precisa existir no catálogo (ou
 * ser uma chave antiga conhecida). Uma chave com erro de digitação nenhum
 * cargo recebe: a rota fica só para o administrador.
 */

const SRC = join(__dirname, '..', '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

type Use = { label: string; action: string; resource: string };

const controllers = sourceFiles(SRC).filter(
  (file) =>
    file.endsWith('.controller.ts') &&
    /@Has(Any)?Permission\(/.test(readFileSync(file, 'utf8')),
);

const decoratorUses: Use[] = controllers.flatMap((file) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const exported = require(file);
  return Object.values(exported)
    .filter((value): value is any => typeof value === 'function')
    .flatMap((klass) =>
      Object.getOwnPropertyNames(klass.prototype)
        .filter((name) => name !== 'constructor')
        .flatMap((name) => {
          const handler = klass.prototype[name];
          const single = Reflect.getMetadata(HAS_PERMISSION_KEY, handler);
          const any = Reflect.getMetadata(HAS_ANY_PERMISSION_KEY, handler);
          const required: { action: string; resource: string }[] = [
            ...(single ? [single] : []),
            ...(any ?? []),
          ];
          return required.map((permission) => ({
            label: `${relative(SRC, file)} ${klass.name}.${name}`,
            ...permission,
          }));
        }),
    );
});

// Conferências no código: abacService.hasPermission(user, 'acao', 'recurso')
const inlineUses: Use[] = sourceFiles(SRC).flatMap((file) => {
  const source = readFileSync(file, 'utf8');
  const uses: Use[] = [];
  const pattern = /hasPermission\(\s*[^,()]+,\s*'([a-z]+)',\s*'([a-z_:]+)'/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    uses.push({
      label: relative(SRC, file),
      action: match[1],
      resource: match[2],
    });
  }
  return uses;
});

const categoryUses: Use[] = Object.entries(CATEGORY_KIND_PERMISSION).map(
  ([kind, resource]) => ({
    label: `categoria ${kind}`,
    action: 'edit',
    resource,
  }),
);

const uses = [...decoratorUses, ...inlineUses, ...categoryUses];

describe('catálogo de permissões', () => {
  it('a varredura acha os decorators e as conferências no código', () => {
    expect(decoratorUses.length).toBeGreaterThan(50);
    expect(inlineUses.length).toBeGreaterThan(0);
  });

  it.each(
    uses.map((use) => [`${use.label} ${use.resource}:${use.action}`, use]),
  )('%s', (_label, use: Use) => {
    expect({
      resource: use.resource,
      known: isKnownResource(use.resource),
    }).toEqual({ resource: use.resource, known: true });
    expect(PERMISSION_ACTIONS as readonly string[]).toContain(use.action);
  });

  it('valida as permissões gravadas num cargo', () => {
    expect(isKnownPermission('*')).toBe(true);
    expect(isKnownPermission('sale:quotation:edit')).toBe(true);
    expect(isKnownPermission('sale:other_sellers:view')).toBe(true);
    expect(isKnownPermission('sale:quotaton:edit')).toBe(false);
    expect(isKnownPermission('sale:quotation:approve')).toBe(false);
    expect(isKnownPermission('sale:quotation')).toBe(false);
    expect(isCatalogResource('financial:payable')).toBe(false);
  });
});
