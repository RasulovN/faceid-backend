import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, Observable } from 'rxjs';
import { Paginated } from '../dto/pagination.dto';
import { SKIP_ENVELOPE_KEY } from '../decorators';

/** Barcha muvaffaqiyatli javoblarni kontrakt envelope'iga o'raydi */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();

    return next.handle().pipe(
      map((data: unknown) => {
        if (data instanceof Paginated) {
          return { success: true, data: data.items, error: null, meta: data.meta };
        }
        return { success: true, data: data ?? null, error: null };
      }),
    );
  }
}
