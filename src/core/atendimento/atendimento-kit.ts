import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { pathToFileURL } from 'url';

import type * as BotContract from '../../../atendimento/base/server/bot-contract.mjs';
import type * as Health from '../../../atendimento/base/server/health.mjs';
import type * as Provision from '../../../atendimento/base/server/provision.mjs';
import type * as Phone from '../../../atendimento/base/shared/phone.mjs';
import type * as Report from '../../../atendimento/base/shared/report.mjs';
import type * as Settings from '../../../atendimento/base/shared/settings.mjs';

/**
 * A base do kit de atendimento (`atendimento/base`, na raiz do repositório)
 * é ESM e não se edita: a atualização do kit troca os arquivos. Este projeto
 * compila para CommonJS, em que o `import()` vira `require()` — e o Node 18
 * da imagem não carrega ESM por `require`. Por isso o `import()` nativo, que
 * o TypeScript não reescreve quando vem de uma função montada em tempo de
 * execução. Os tipos vêm direto dos `.d.mts` da base.
 */
const nativeImport = new Function('specifier', 'return import(specifier)') as <
  T,
>(
  specifier: string,
) => Promise<T>;

export type AtendimentoKit = {
  settings: typeof Settings;
  report: typeof Report;
  contract: typeof BotContract;
  provision: typeof Provision;
  health: typeof Health;
  phone: typeof Phone;
};

export interface AtendimentoEscolhas {
  modelo?: string;
  chatwoot?: { features_off?: string[]; moldura?: boolean };
  robo?: { nome?: string };
  marca?: { nome?: string };
}

/**
 * A pasta do kit: sobe a partir deste arquivo até achar `atendimento/kit.json`.
 * Vale para `src` (testes), `dist/src` (build) e a imagem Docker, que copia a
 * pasta para a raiz da aplicação.
 */
export function findKitDir(start: string = __dirname): string {
  let current = resolve(start);
  for (;;) {
    const candidate = join(current, 'atendimento');
    if (existsSync(join(candidate, 'kit.json'))) return candidate;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(
        'Não encontrei a pasta do kit de atendimento (atendimento/kit.json).',
      );
    }
    current = parent;
  }
}

let loaded: Promise<AtendimentoKit> | null = null;

export function loadAtendimentoKit(): Promise<AtendimentoKit> {
  if (!loaded) {
    const base = join(findKitDir(), 'base');
    const load = <T>(file: string) =>
      nativeImport<T>(pathToFileURL(join(base, file)).href);
    loaded = Promise.all([
      load<typeof Settings>('shared/settings.mjs'),
      load<typeof Report>('shared/report.mjs'),
      load<typeof BotContract>('server/bot-contract.mjs'),
      load<typeof Provision>('server/provision.mjs'),
      load<typeof Health>('server/health.mjs'),
      load<typeof Phone>('shared/phone.mjs'),
    ])
      .then(([settings, report, contract, provision, health, phone]) => ({
        settings,
        report,
        contract,
        provision,
        health,
        phone,
      }))
      .catch((error) => {
        loaded = null;
        throw error;
      });
  }
  return loaded;
}

export function readEscolhas(): AtendimentoEscolhas {
  try {
    return JSON.parse(
      readFileSync(join(findKitDir(), 'escolhas.json'), 'utf8'),
    ) as AtendimentoEscolhas;
  } catch {
    return {};
  }
}
