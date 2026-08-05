import { Inject, Injectable, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';

/**
 * Cria um guard de rate limit que carrega as proprias opcoes, em vez de le-las
 * da configuracao global do ThrottlerModule.
 *
 * O ThrottlerModule e @Global: cada `forRoot()` sobrescreve o mesmo token de
 * opcoes e a ultima registracao passa a valer para TODOS os controllers. Com
 * tres modulos registrando throttlers com nomes diferentes ('auth', 'public' e
 * 'default'), o teto de 3/min dos endpoints publicos acabava governando tambem
 * a listagem de notas fiscais — e o `@SkipThrottle()`/`@Throttle({ default })`
 * do modulo fiscal deixava de ter efeito, porque so valem para o throttler
 * chamado 'default', que nao era o vencedor.
 *
 * Fixando as opcoes na classe gerada, o limite aplicado a cada controller nao
 * depende mais da ordem em que os modulos sao registrados.
 *
 * Os parametros precisam do `@Inject` explicito: o ThrottlerGuard declara
 * `@Inject(THROTTLER_OPTIONS)` no primeiro parametro e essa metadata seria
 * herdada, deslocando as dependencias da subclasse.
 */
export function ScopedThrottlerGuard(
  throttlers: ThrottlerOptions[],
): Type<ThrottlerGuard> {
  @Injectable()
  class ScopedGuard extends ThrottlerGuard {
    constructor(
      @Inject(ThrottlerStorage) storageService: ThrottlerStorage,
      @Inject(Reflector) reflector: Reflector,
    ) {
      super(throttlers, storageService, reflector);
    }
  }

  return ScopedGuard;
}
