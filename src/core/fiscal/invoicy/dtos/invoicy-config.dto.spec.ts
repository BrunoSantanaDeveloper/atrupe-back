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

/**
 * O formulário manda '' para campo limpo e null para select "não informar".
 * O DTO precisa distinguir "limpar" (null) de "não mexer" (undefined), senão
 * um PATCH parcial apaga o que estava gravado.
 */
describe('campos da Reforma no UpdateInvoicyConfigDto', () => {
  const instanciar = (dto: object) =>
    plainToInstance(UpdateInvoicyConfigDto, dto);
  const erroDe = async (dto: object, campo: string) =>
    (await validate(instanciar(dto))).find((e) => e.property === campo);

  it("'' em cIndOp vira null (limpa o padrão)", () => {
    expect(
      instanciar({ indicadorOperacaoNfse: '' }).indicadorOperacaoNfse,
    ).toBeNull();
  });

  it('cIndOp ausente continua undefined (PATCH parcial não limpa)', () => {
    expect(instanciar({ name: 'x' }).indicadorOperacaoNfse).toBeUndefined();
  });

  it('cIndOp com mais de 6 caracteres é recusado', async () => {
    expect(
      await erroDe(
        { indicadorOperacaoNfse: '1003011' },
        'indicadorOperacaoNfse',
      ),
    ).toBeDefined();
  });

  it("'2' em regApIbsCbsSn vira 2 e passa", async () => {
    const inst = instanciar({ regApIbsCbsSn: '2' });
    expect(inst.regApIbsCbsSn).toBe(2);
    expect(
      await erroDe({ regApIbsCbsSn: '2' }, 'regApIbsCbsSn'),
    ).toBeUndefined();
  });

  it('null em regApIbsCbsSn é aceito e vira null', async () => {
    expect(instanciar({ regApIbsCbsSn: null }).regApIbsCbsSn).toBeNull();
    expect(
      await erroDe({ regApIbsCbsSn: null }, 'regApIbsCbsSn'),
    ).toBeUndefined();
  });

  it('regApIbsCbsSn fora de 1..3 é recusado', async () => {
    expect(await erroDe({ regApIbsCbsSn: 4 }, 'regApIbsCbsSn')).toBeDefined();
  });
});
