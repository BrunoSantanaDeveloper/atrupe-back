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
      it.each([1, 2])('aceita CRT %i (Simples Nacional)', async (crt) => {
        expect(await erroDeCrt({ emitCrt: crt }, Classe)).toBeUndefined();
      });

      it.each([3, 4])('recusa CRT %i com motivo explícito', async (crt) => {
        const erro = await erroDeCrt({ emitCrt: crt }, Classe);
        expect(erro).toBeDefined();
        // Casa com o que o usuário precisa ler — os regimes recusados e para
        // onde ir —, não com a redação exata, que muda conforme o suporte
        // avança.
        const mensagem = Object.values(erro!.constraints ?? {}).join(' ');
        expect(mensagem).toMatch(/Lucro Real/i);
        expect(mensagem).toMatch(/Lucro Presumido/i);
        expect(mensagem).toMatch(/suporte/i);
      });
    });
  }
});
