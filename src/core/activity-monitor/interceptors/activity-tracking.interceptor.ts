import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ActivityMonitorService } from '../activity-monitor.service';

@Injectable()
export class ActivityTrackingInterceptor implements NestInterceptor {
  constructor(
    private readonly activityMonitorService: ActivityMonitorService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Extrair userId de diferentes estruturas possíveis
    // - user.userId (JWT payload após autenticação)
    // - user.sub (padrão JWT)
    // - user.id (objeto user completo no login)
    const userId = user?.userId || user?.sub || user?.id;

    // Apenas rastrear se houver um usuário autenticado
    if (user && userId) {
      const companyId = user.companyId || user.employee?.[0]?.company?.id;
      const employeeId = user.employeeId || user.employee?.[0]?.id;
      const sessionId = request.headers['x-session-id'];
      const endpoint = request.url;
      const method = request.method;
      const ipAddress =
        request.headers['x-forwarded-for'] || request.connection.remoteAddress;
      const userAgent = request.headers['user-agent'];

      // Registrar atividade de forma assíncrona (não bloquear a requisição)
      this.activityMonitorService
        .trackActivity({
          userId,
          companyId,
          employeeId,
          sessionId,
          endpoint,
          method,
          ipAddress,
          userAgent,
        })
        .catch((error) => {
          // Log do erro mas não falhar a requisição
          console.error('Erro ao rastrear atividade:', error);
        });
    }

    return next.handle().pipe(
      tap(() => {
        // Aqui você pode adicionar lógica adicional após a resposta se necessário
      }),
    );
  }
}
