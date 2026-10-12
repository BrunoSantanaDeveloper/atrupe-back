import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { Prisma } from '@prisma/client';
import { PATH_METADATA } from '@nestjs/common/constants';
import { TENANT_RESOURCE_KEY } from './tenant-resource.decorator';

/**
 * Todo @TenantResource do código aponta para um model que existe e tem
 * companyId, e para um parâmetro que está na rota. O TenantGuard recusa
 * quando o model não existe; antes liberava, e um nome errado deixava a rota
 * aberta a outras empresas sem aviso.
 */

const SRC = join(__dirname, '..', '..', '..');

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return controllerFiles(path);
    return name.endsWith('.controller.ts') ? [path] : [];
  });
}

const files = controllerFiles(SRC).filter((file) =>
  readFileSync(file, 'utf8').includes('@TenantResource('),
);

// Os models pelo nome do delegate do Prisma: Client -> client
const models = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [
    model.name[0].toLowerCase() + model.name.slice(1),
    model,
  ]),
);

// Os parâmetros de um caminho, inclusive os com regex: ':id([0-9a-f-]{36})'
const routeParams = (path: string) =>
  path
    .split('/')
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1).split('(')[0].replace('?', ''));

type Usage = {
  label: string;
  model: string;
  paramName: string;
  paths: string[];
};

const usages: Usage[] = files.flatMap((file) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const exported = require(file);
  return Object.values(exported)
    .filter((value): value is any => typeof value === 'function')
    .flatMap((klass) =>
      Object.getOwnPropertyNames(klass.prototype)
        .filter((name) => name !== 'constructor')
        .map((name) => {
          const handler = klass.prototype[name];
          const config = Reflect.getMetadata(TENANT_RESOURCE_KEY, handler);
          if (!config) return null;
          const path = Reflect.getMetadata(PATH_METADATA, handler);
          return {
            label: `${relative(SRC, file)} ${klass.name}.${name}`,
            model: config.model,
            paramName: config.paramName,
            paths: (Array.isArray(path) ? path : [path]).map(String),
          };
        })
        .filter(Boolean),
    );
});

describe('@TenantResource nos controllers', () => {
  it('a varredura acha os controllers que usam o decorator', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(usages.length).toBeGreaterThan(0);
  });

  it.each(usages.map((usage) => [usage.label, usage]))(
    '%s',
    (_label, usage: Usage) => {
      const model = models.get(usage.model);
      expect({ model: usage.model, exists: !!model }).toEqual({
        model: usage.model,
        exists: true,
      });
      expect({
        model: usage.model,
        hasCompanyId: model.fields.some((field) => field.name === 'companyId'),
      }).toEqual({ model: usage.model, hasCompanyId: true });
      expect({
        paramName: usage.paramName,
        inRoute: usage.paths.some((path) =>
          routeParams(path).includes(usage.paramName),
        ),
      }).toEqual({ paramName: usage.paramName, inRoute: true });
    },
  );
});
