import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { internal_getRequestContext, parseContext } from '@vendure/core';

import { MerchantInitialPasswordService } from './merchant-initial-password.service';

@Injectable()
export class MerchantInitialPasswordInterceptor implements NestInterceptor {
    constructor(private readonly merchantInitialPasswordService: MerchantInitialPasswordService) {}

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
        await this.merchantInitialPasswordService.assertRootFieldAccess(
            requestContext,
            parentType,
            parsed.info.fieldName,
        );
        return next.handle();
    }
}
