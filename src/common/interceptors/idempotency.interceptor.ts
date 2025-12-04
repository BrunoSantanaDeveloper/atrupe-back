import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ConflictException,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../config/prisma/prisma.service';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const idempotencyKey = request.headers['idempotency-key'];

    // Se não há chave de idempotência, apenas continua
    if (!idempotencyKey) {
      return next.handle();
    }

    // Verificar se já existe uma requisição com essa chave
    const existingRequest = await this.prisma.idempotencyKey.findUnique({
      where: { key: idempotencyKey },
    });

    // Se existe e foi completada com sucesso, retorna o resultado armazenado
    if (existingRequest && existingRequest.status === 'SUCCESS') {
      return of(JSON.parse(existingRequest.response));
    }

    // Se existe e está em processamento, retorna conflito
    if (existingRequest && existingRequest.status === 'PROCESSING') {
      throw new ConflictException(
        'Uma requisição com esta chave de idempotência já está sendo processada.',
      );
    }

    // Criar registro de idempotência com status PROCESSING
    await this.prisma.idempotencyKey.create({
      data: {
        key: idempotencyKey,
        status: 'PROCESSING',
        requestPath: request.url,
        requestMethod: request.method,
        userId: request.user?.userId,
      },
    });

    // Processar a requisição e armazenar o resultado
    return next.handle().pipe(
      tap({
        next: async (response) => {
          // Atualizar com sucesso
          await this.prisma.idempotencyKey.update({
            where: { key: idempotencyKey },
            data: {
              status: 'SUCCESS',
              response: JSON.stringify(response),
            },
          });
        },
        error: async (error) => {
          // Atualizar com erro
          await this.prisma.idempotencyKey.update({
            where: { key: idempotencyKey },
            data: {
              status: 'ERROR',
              response: JSON.stringify({
                message: error.message,
                statusCode: error.status,
              }),
            },
          });
        },
      }),
    );
  }
}
