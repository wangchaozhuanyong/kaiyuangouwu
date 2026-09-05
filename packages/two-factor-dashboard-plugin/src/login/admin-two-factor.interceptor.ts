import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { internal_getRequestContext, parseContext } from '@vendure/core';

import { AdminTwoFactorService } from './admin-two-factor.service';

@Injectable()
export class AdminTwoFactorInterceptor implements NestInterceptor {
    constructor(private readonly security: AdminTwoFactorService) {}

    async intercept(context: ExecutionContext, next: CallHandler) {
        const parsed = parseContext(context);
        if (!parsed.isGraphQL || !['Query', 'Mutation'].includes(parsed.info.parentType.name))
            return next.handle();
        const ctx = internal_getRequestContext(parsed.req, context);
        if (ctx.apiType !== 'admin') return next.handle();
        const field = parsed.info.fieldName;
        const publicFields = [
            'adminBeginLogin',
            'adminCompleteTwoFactorLogin',
            'login',
            'authenticate',
            'logout',
        ];
        if (!publicFields.includes(field)) await this.security.assertSession(ctx);
        if (field === 'login' || field === 'authenticate') {
            const args = GqlExecutionContext.create(context).getArgs<{
                username?: string;
                input?: { native?: { username?: string } };
            }>();
            const username = field === 'login' ? args.username : args.input?.native?.username;
            if (username !== undefined)
                await this.security.loginBudget(
                    username,
                    parsed.req.ip || parsed.req.socket.remoteAddress || 'unknown',
                );
        }
        if (field.startsWith('admin') && (field.includes('TwoFactor') || field === 'adminBeginLogin')) {
            parsed.res.setHeader('Cache-Control', 'no-store');
        }
        return next.handle();
    }
}
