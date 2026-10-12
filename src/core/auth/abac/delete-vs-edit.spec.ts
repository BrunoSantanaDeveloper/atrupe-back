import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { HAS_PERMISSION_KEY } from './has-permission.decorator';
import { HAS_ANY_PERMISSION_KEY } from './has-any-permission.decorator';

/**
 * Regra do time (pendencias.md §2 e "Convenções" do contrato): excluir um
 * cadastro próprio pede `delete`; remover uma linha de dentro do registro em
 * edição (item do produto, subcategoria da natureza, colaborador do perfil,
 * item da folha) pede `edit`. Uma rota DELETE de linha de dentro não pode
 * exigir só `delete`: quem edita o registro precisa conseguir tirar a linha.
 */

const SRC = join(__dirname, '..', '..', '..');

// Segmentos que marcam linha de dentro de um registro
const INNER_SEGMENTS = [
  'item',
  'items',
  'line',
  'lines',
  'sub-category',
  'employees',
  'field',
  'formula',
];

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return controllerFiles(path);
    return name.endsWith('.controller.ts') ? [path] : [];
  });
}

const segmentsOf = (path: string) =>
  path.split('/').filter((segment) => segment !== '');

function isInnerLine(paths: string[]) {
  return paths.some((path) => {
    const segments = segmentsOf(path);
    const params = segments.filter((segment) => segment.startsWith(':'));
    return (
      params.length >= 2 ||
      segments.some((segment) => INNER_SEGMENTS.includes(segment))
    );
  });
}

type DeleteRoute = {
  label: string;
  paths: string[];
  actions: string[];
};

const files = controllerFiles(SRC).filter((file) => {
  const source = readFileSync(file, 'utf8');
  return (
    source.includes('@Delete(') &&
    (source.includes('@HasPermission(') ||
      source.includes('@HasAnyPermission('))
  );
});

const routes: DeleteRoute[] = files.flatMap((file) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const exported = require(file);
  return Object.values(exported)
    .filter((value): value is any => typeof value === 'function')
    .flatMap((klass) =>
      Object.getOwnPropertyNames(klass.prototype)
        .filter((name) => name !== 'constructor')
        .map((name) => {
          const handler = klass.prototype[name];
          if (
            Reflect.getMetadata(METHOD_METADATA, handler) !==
            RequestMethod.DELETE
          ) {
            return null;
          }
          const single = Reflect.getMetadata(HAS_PERMISSION_KEY, handler);
          const any = Reflect.getMetadata(HAS_ANY_PERMISSION_KEY, handler);
          const required: { action: string }[] = any?.length
            ? any
            : single
              ? [single]
              : [];
          if (!required.length) return null;
          const path = Reflect.getMetadata(PATH_METADATA, handler);
          return {
            label: `${relative(SRC, file)} ${klass.name}.${name}`,
            paths: (Array.isArray(path) ? path : [path]).map(String),
            actions: required.map((permission) => permission.action),
          };
        })
        .filter(Boolean),
    );
});

const innerLines = routes.filter((route) => isInnerLine(route.paths));

describe('regra delete × edit nas rotas DELETE', () => {
  it('a varredura acha rotas DELETE com permissão', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it.each(innerLines.map((route) => [route.label, route]))(
    'linha de dentro do registro aceita edit: %s',
    (_label, route: DeleteRoute) => {
      expect({
        paths: route.paths,
        aceitaEdit: route.actions.includes('edit'),
      }).toEqual({ paths: route.paths, aceitaEdit: true });
    },
  );
});
