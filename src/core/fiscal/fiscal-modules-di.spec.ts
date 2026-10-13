import * as fs from 'fs';
import * as path from 'path';

/**
 * Guarda de injeção de dependência para os módulos fiscais.
 *
 * MOTIVO
 * Aplicar `PermissionsGuard` num controller exige que o módulo daquele
 * controller tenha `AbacService` no contexto — via import de `AuthModule`
 * (que o exporta) ou declarando-o como provider. Faltando isso, o Nest só
 * falha no BOOTSTRAP, com:
 *
 *   Nest can't resolve dependencies of the PermissionsGuard (Reflector, ?)
 *
 * Testes unitários não pegam esse erro: eles montam TestingModule com os
 * providers mockados e nunca exercitam o grafo real. Foi exatamente assim que
 * `ProductFiscalModule` passou em 268 testes e derrubou o container no deploy.
 *
 * Este teste é estático de propósito — compilar o AppModule inteiro exigiria
 * banco e variáveis de ambiente, e o objetivo aqui é falhar rápido no CI.
 */
describe('Módulos com PermissionsGuard têm AbacService no contexto', () => {
  const SRC = path.join(__dirname, '..', '..');

  function listFiles(dir: string, suffix: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        out.push(...listFiles(full, suffix));
      } else if (entry.name.endsWith(suffix)) {
        out.push(full);
      }
    }
    return out;
  }

  it('todo módulo cujo controller usa PermissionsGuard resolve AbacService', () => {
    const controllers = listFiles(SRC, '.controller.ts').filter((f) =>
      fs.readFileSync(f, 'utf8').includes('PermissionsGuard'),
    );

    // Sanidade: se o projeto parar de usar PermissionsGuard, o teste vira
    // trivialmente verde e deixa de proteger — melhor falhar e revisar.
    expect(controllers.length).toBeGreaterThan(5);

    const quebrados: string[] = [];

    for (const controller of controllers) {
      const dir = path.dirname(controller);
      const modules = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.module.ts'))
        .map((f) => path.join(dir, f));

      // Controller sem módulo irmão: registrado em outro lugar, fora do escopo
      // desta checagem estática.
      if (modules.length === 0) continue;

      // A pasta pode ter um módulo sem controller (auditoria, parâmetros):
      // quem precisa do AbacService é o módulo que registra este controller.
      // Se nenhum irmão o importa, todos seguem conferidos
      const controllerFile = path.basename(controller, '.ts');
      const owners = modules.filter((modulePath) =>
        fs.readFileSync(modulePath, 'utf8').includes(`./${controllerFile}'`),
      );

      for (const modulePath of owners.length ? owners : modules) {
        const raw = fs.readFileSync(modulePath, 'utf8');
        const importaAuthModule = /AuthModule/.test(raw);
        const declaraAbac = /AbacService/.test(raw);

        if (!importaAuthModule && !declaraAbac) {
          quebrados.push(path.relative(SRC, modulePath));
        }
      }
    }

    expect(quebrados).toEqual([]);
  });
});
