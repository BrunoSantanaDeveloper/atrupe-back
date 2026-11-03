import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  CreateInvoicyConfigDto,
  SetCscDto,
  UpdateInvoicyConfigDto,
} from './invoicy-config.dto';

/**
 * O CRT aceito é a lista fechada do layout do provedor: 1, 2, 3 e 4. A trava
 * vive no DTO, e não só na tela, porque a API é pública para o frontend —
 * validar apenas o select deixaria a porta aberta a um código inexistente,
 * que o provedor recusaria por schema depois de a nota já ter número.
 */
describe('CRT do emissor', () => {
  const erroDeCrt = async (dto: object, Classe: any) => {
    const erros = await validate(plainToInstance(Classe, dto));
    return erros.find((e) => e.property === 'emitCrt');
  };

  for (const Classe of [CreateInvoicyConfigDto, UpdateInvoicyConfigDto]) {
    describe(Classe.name, () => {
      // 1 e 2 = Simples Nacional; 3 = Regime Normal (Lucro Real e
      // Presumido); 4 = MEI.
      it.each([1, 2, 3, 4])('aceita CRT %i', async (crt) => {
        expect(await erroDeCrt({ emitCrt: crt }, Classe)).toBeUndefined();
      });

      /**
       * Acima de 4 nao existe codigo: o provedor recusaria por schema, e a
       * mensagem precisa dizer qual e' a lista em vez de repetir "invalido".
       */
      it.each([0, 5])('recusa CRT %i listando os válidos', async (crt) => {
        const erro = await erroDeCrt({ emitCrt: crt }, Classe);
        expect(erro).toBeDefined();
      });

      it('a mensagem do teto cita o MEI como opção válida', async () => {
        const erro = await erroDeCrt({ emitCrt: 5 }, Classe);
        const mensagem = Object.values(erro!.constraints ?? {}).join(' ');
        expect(mensagem).toMatch(/MEI/);
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

/**
 * O CSC salvo aqui é o que a ativação envia ao cadastro do provedor, que guarda
 * o identificador com até 6 caracteres e o código com até 36. Recusar no
 * formulário é melhor que descobrir na ativação ou na primeira nota.
 */
describe('SetCscDto', () => {
  const CSC = 'ABCDEF12-3456-7890-ABCD-EF1234567890';

  const validar = async (dto: object) => {
    const inst = plainToInstance(SetCscDto, dto);
    return { inst, erros: await validate(inst) };
  };

  it('apara o espaço que vem junto ao copiar do portal', async () => {
    const { inst, erros } = await validar({
      cscId: ' 1 ',
      cscToken: ` ${CSC}`,
    });

    expect(erros).toHaveLength(0);
    expect(inst.cscId).toBe('1');
    expect(inst.cscToken).toBe(CSC);
  });

  it('recusa identificador com mais de 6 dígitos, explicando onde achar o certo', async () => {
    const { erros } = await validar({
      cscId: '374425537129440041',
      cscToken: CSC,
    });
    const mensagem = Object.values(
      erros.find((e) => e.property === 'cscId')?.constraints ?? {},
    ).join(' ');

    expect(mensagem).toContain('até 6 dígitos');
    expect(mensagem).toContain('portal da SEFAZ');
  });

  it('recusa código com mais de 36 caracteres', async () => {
    const { erros } = await validar({ cscId: '1', cscToken: `${CSC}X` });

    expect(erros.find((e) => e.property === 'cscToken')).toBeDefined();
  });

  it('só espaços conta como não informado', async () => {
    const { erros } = await validar({ cscId: '   ', cscToken: CSC });

    expect(erros.find((e) => e.property === 'cscId')).toBeDefined();
  });
});
