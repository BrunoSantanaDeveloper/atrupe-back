import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  CreateInvoicyConfigDto,
  UpdateInvoicyConfigDto,
} from './invoicy-config.dto';

/**
 * O CRT fica limitado ao Simples Nacional enquanto o cálculo de imposto por
 * item não existir. A montagem da nota destaca base e valor zerados: correto
 * para o Simples, subdeclarado para Lucro Real, Lucro Presumido e MEI.
 *
 * A trava vive no DTO, e não só na tela, porque a API é pública para o
 * frontend — bloquear apenas o select deixaria a porta aberta.
 */
describe('CRT do emissor', () => {
  const erroDeCrt = async (dto: object, Classe: any) => {
    const erros = await validate(plainToInstance(Classe, dto));
    return erros.find((e) => e.property === 'emitCrt');
  };

  for (const Classe of [CreateInvoicyConfigDto, UpdateInvoicyConfigDto]) {
    describe(Classe.name, () => {
      // 1 e 2 = Simples Nacional; 3 = Regime Normal (Lucro Real e Presumido).
      it.each([1, 2, 3])('aceita CRT %i', async (crt) => {
        expect(await erroDeCrt({ emitCrt: crt }, Classe)).toBeUndefined();
      });

      /** CRT 4 e' MEI, que nao tem apuracao propria implementada. */
      it('recusa CRT 4 (MEI) com motivo explícito', async () => {
        const erro = await erroDeCrt({ emitCrt: 4 }, Classe);
        expect(erro).toBeDefined();
        // Casa com o que o usuário precisa ler — o regime recusado e para
        // onde ir —, não com a redação exata.
        const mensagem = Object.values(erro!.constraints ?? {}).join(' ');
        expect(mensagem).toMatch(/MEI/);
        expect(mensagem).toMatch(/suporte/i);
      });
    });
  }
});
