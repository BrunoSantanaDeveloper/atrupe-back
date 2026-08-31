import { Test } from '@nestjs/testing';
import { PrismaModule } from '../../config/prisma/prisma.module';
import { SystemSettingsModule } from './system-settings.module';
import { IcmsAliquotaInternaService } from '../fiscal/shared/icms-aliquota-interna.service';
import { SystemSettingsService } from './system-settings.service';

/**
 * Teste de FIAÇÃO, não de comportamento.
 *
 * Os specs de serviço montam o provider com mock e nunca exercitam o grafo
 * real de módulos — então uma dependência não resolvida passa por lint, tsc e
 * pela suíte inteira, e só aparece quando o container sobe em produção. Foi o
 * que aconteceu: `IcmsAliquotaInternaService` injeta o `PrismaService` do
 * pacote `nestjs-prisma`, que é um token diferente do `PrismaService` do
 * projeto, e o módulo não importava o `PrismaModule` correspondente. O app
 * quebrou no boot com "Nest can't resolve dependencies".
 *
 * `compile()` resolve as dependências sem disparar os hooks de ciclo de vida,
 * então nada tenta abrir conexão com o banco.
 *
 * O `PrismaModule` do projeto entra aqui porque é `@Global()` e registrado no
 * AppModule — sem ele o teste acusaria uma falha que produção não tem. O que
 * o teste cobra é o que o módulo precisa declarar ALÉM dos globais do app, que
 * é exatamente onde estava o defeito.
 */
describe('SystemSettingsModule (fiação)', () => {
  it('resolve todos os providers com o grafo real de módulos', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, SystemSettingsModule],
    }).compile();

    expect(moduleRef.get(SystemSettingsService)).toBeDefined();
    expect(moduleRef.get(IcmsAliquotaInternaService)).toBeDefined();

    await moduleRef.close();
  });
});
