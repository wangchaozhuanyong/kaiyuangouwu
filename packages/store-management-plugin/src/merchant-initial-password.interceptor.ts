import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { internal_getRequestContext, parseContext } from '@vendure/core';

import { MerchantInitialPasswordService } from './merchant-initial-password.service';

const SENSITIVE_ACTION_PASSWORD_HEADER = 'x-vendure-sensitive-action-password';

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
        const passwordHeader = parsed.req.headers?.[SENSITIVE_ACTION_PASSWORD_HEADER];
        const password = Array.isArray(passwordHeader) ? passwordHeader[0] : passwordHeader;
        const args = GqlExecutionContext.create(context).getArgs<Record<string, unknown>>();
        await this.merchantInitialPasswordService.assertRootFieldAccess(
            requestContext,
            parentType,
            parsed.info.fieldName,
        );
        if (parentType === 'Mutation') {
            await this.merchantInitialPasswordService.assertSensitiveAdminMutation(
                requestContext,
                parsed.info.fieldName,
                password,
                args,
            );
        }
        return next.handle();
    }
}
