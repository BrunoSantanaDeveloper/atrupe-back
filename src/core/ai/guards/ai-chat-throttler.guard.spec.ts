import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ThrottlerException, ThrottlerModule } from '@nestjs/throttler';
import {
  AI_CHAT_LIMIT_MESSAGE,
  AiChatThrottlerGuard,
} from './ai-chat-throttler.guard';
import { AiController } from '../ai.controller';

class FakeController {
  chat() {}
}

function contextFor(userId: string): ExecutionContext {
  const req = { user: { userId }, ip: '10.0.0.1', headers: {} };
  const res = { header: jest.fn(), setHeader: jest.fn() };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => FakeController.prototype.chat,
    getClass: () => FakeController,
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

describe('AiChatThrottlerGuard', () => {
  let guard: AiChatThrottlerGuard;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([])],
      providers: [AiChatThrottlerGuard],
    }).compile();
    await module.init();
    guard = module.get(AiChatThrottlerGuard);
  });

  // O armazenamento do throttler agenda um timer por janela (o de 1 hora
  // inclusive): sem fechar o módulo, o jest não termina
  afterEach(async () => {
    await module.close();
  });

  it('o chat da IA passa pelo limite', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AiController.prototype.chat),
    ).toEqual([AiChatThrottlerGuard]);
  });

  it('o 21º pedido no minuto é recusado em português', async () => {
    for (let i = 0; i < 20; i++) {
      await expect(guard.canActivate(contextFor('u-1'))).resolves.toBe(true);
    }
    const error = await guard.canActivate(contextFor('u-1')).then(
      () => undefined,
      (e) => e,
    );
    expect(error).toBeInstanceOf(ThrottlerException);
    expect(error.message).toBe(AI_CHAT_LIMIT_MESSAGE);
  });

  it('cada usuário tem a própria conta', async () => {
    for (let i = 0; i < 20; i++) {
      await guard.canActivate(contextFor('u-1'));
    }
    await expect(guard.canActivate(contextFor('u-2'))).resolves.toBe(true);
  });
});
