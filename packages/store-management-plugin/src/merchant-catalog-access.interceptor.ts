import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { internal_getRequestContext, parseContext } from '@vendure/core';

import { MerchantCatalogAccessService } from './merchant-catalog-access.service';

@Injectable()
export class MerchantCatalogAccessInterceptor implements NestInterceptor {
    constructor(private readonly merchantCatalogAccessService: MerchantCatalogAccessService) {}

    async intercept(context: ExecutionContext, next: CallHandler) {
        const parsed = parseContext(context);
        if (!parsed.isGraphQL) {
            return next.handle();
        }
        const parentType = parsed.info.parentType.name;
        if (parentType !== 'Query' && parentType !== 'Mutation') {
            return next.handle();
        }
        const requestContext = internal_getRequestContext(parsed.req, context);
        const args = GqlExecutionContext.create(context).getArgs<Record<string, unknown>>();
        await this.merchantCatalogAccessService.assertRootFieldAccess(
            requestContext,
            parentType,
            parsed.info.fieldName,
            args,
        );
        return next.handle();
    }
}
