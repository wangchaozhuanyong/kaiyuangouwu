import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { internal_getRequestContext, parseContext } from '@vendure/core';
import { catchError, from, mergeMap, throwError } from 'rxjs';

import { protectedOperation } from './policy';
import { ShopAbuseProtectionService } from './service';

@Injectable()
export class ShopAbuseInterceptor implements NestInterceptor {
    constructor(private readonly security: ShopAbuseProtectionService) {}
    async intercept(context: ExecutionContext, next: CallHandler) {
        const parsed = parseContext(context);
        if (!parsed.isGraphQL || !['Query', 'Mutation'].includes(parsed.info.parentType.name))
            return next.handle();
        const ctx = internal_getRequestContext(parsed.req, context);
        if (ctx.apiType !== 'shop') return next.handle();
        const operation = protectedOperation(
            parsed.info.fieldName,
            GqlExecutionContext.create(context).getArgs(),
            ctx.activeUserId,
        );
        if (!operation) return next.handle();
        const admission = await this.security.before(ctx, operation);
        return next.handle().pipe(
            mergeMap(async pending => {
                // Vendure's transaction interceptor emits Promise<Result>. Inspect the resolved result,
                // before the outer translation interceptor unwraps it for GraphQL serialization.
                const result = await pending;
                if (result && typeof result.errorCode === 'string')
                    await this.security.observeFailure(admission);
                return result;
            }),
            catchError(error =>
                from(this.security.observeFailure(admission)).pipe(mergeMap(() => throwError(() => error))),
            ),
        );
    }
}
