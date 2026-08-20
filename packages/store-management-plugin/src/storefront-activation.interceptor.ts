import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { internal_getRequestContext, parseContext } from '@vendure/core';

import { StorefrontActivationService } from './storefront-activation.service';

@Injectable()
export class StorefrontActivationInterceptor implements NestInterceptor {
    constructor(private readonly storefrontActivationService: StorefrontActivationService) {}

    async intercept(context: ExecutionContext, next: CallHandler) {
        const parsed = parseContext(context);
        if (!parsed.isGraphQL) return next.handle();
        const parentType = parsed.info.parentType.name;
        if (parentType !== 'Query' && parentType !== 'Mutation') return next.handle();
        const requestContext = internal_getRequestContext(parsed.req, context);
        await this.storefrontActivationService.assertActive(requestContext);
        return next.handle();
    }
}
