import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { IsObject, IsString } from 'class-validator';
import { WebhooksController } from './webhooks.controller';

/**
 * Regressão: o corpo do webhook do Asaas contra o ValidationPipe GLOBAL.
 *
 * O pipe roda com `whitelist` + `forbidNonWhitelisted` (src/app.module.ts).
 * Enquanto o corpo foi declarado como classe com decorators, todo webhook real
 * era recusado com 400 — o Asaas manda `id` e `dateCreated` no topo, que a
 * classe não declarava, e exigia `payment` E `subscription` ao mesmo tempo,
 * coisa que nenhum evento traz. Nenhum webhook chegou a ser processado.
 *
 * Estes testes usam o MESMO tipo que o controller declara e a MESMA
 * configuração do pipe de produção, para que uma volta ao formato de classe
 * quebre aqui e não em produção.
 */
describe('Corpo do webhook do Asaas contra o ValidationPipe global', () => {
  // Precisa ser idêntica à de src/app.module.ts
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  // O tipo que o controller realmente declara no @Body()
  const metatype = Reflect.getMetadata(
    'design:paramtypes',
    WebhooksController.prototype,
    'handleAsaasWebhook',
  )[0];

  const metadata = { type: 'body' as const, metatype, data: '' };

  const eventoDeCobranca = {
    id: 'evt_05b708f961d739ea7eba7e4db318f621&368604920',
    event: 'PAYMENT_CONFIRMED',
    dateCreated: '2026-09-22 10:31:02',
    payment: {
      object: 'payment',
      id: 'pay_080225913252',
      customer: 'cus_000005219613',
      subscription: 'sub_vxqcgvyshkbvxrfj',
      value: 147,
      netValue: 142.51,
      billingType: 'CREDIT_CARD',
      status: 'CONFIRMED',
      dueDate: '2026-09-24',
      invoiceUrl: 'https://www.asaas.com/i/080225913252',
    },
  };

  const eventoDeAssinatura = {
    id: 'evt_9f1c7a2b',
    event: 'SUBSCRIPTION_DELETED',
    dateCreated: '2026-09-22 10:40:00',
    subscription: {
      object: 'subscription',
      id: 'sub_vxqcgvyshkbvxrfj',
      status: 'INACTIVE',
      cycle: 'MONTHLY',
    },
  };

  it('aceita um evento de cobrança sem rejeitar id e dateCreated', async () => {
    await expect(pipe.transform(eventoDeCobranca, metadata)).resolves.toEqual(
      eventoDeCobranca,
    );
  });

  it('preserva o id do evento, que é a chave de idempotência', async () => {
    const saida: any = await pipe.transform(eventoDeCobranca, metadata);
    expect(saida.id).toBe(eventoDeCobranca.id);
    expect(saida.dateCreated).toBe(eventoDeCobranca.dateCreated);
  });

  it('aceita um evento de assinatura, que não traz payment', async () => {
    await expect(pipe.transform(eventoDeAssinatura, metadata)).resolves.toEqual(
      eventoDeAssinatura,
    );
  });

  it('aceita um campo novo que o Asaas venha a incluir', async () => {
    const comCampoNovo = { ...eventoDeCobranca, campoFuturo: 'qualquer' };
    await expect(pipe.transform(comCampoNovo, metadata)).resolves.toEqual(
      comCampoNovo,
    );
  });

  // Este caso existe para provar que os anteriores não passam por acaso:
  // reproduz o formato antigo (classe com decorators) e exige a recusa que
  // derrubava todos os webhooks em produção.
  it('demonstra que o formato antigo, em classe, recusaria o mesmo payload', async () => {
    class FormatoAntigoDto {
      @IsString()
      event: string;

      @IsObject()
      payment?: any;

      @IsObject()
      subscription?: any;
    }

    await expect(
      pipe.transform(eventoDeCobranca, {
        type: 'body',
        metatype: FormatoAntigoDto,
        data: '',
      }),
    ).rejects.toThrow();
  });
});
