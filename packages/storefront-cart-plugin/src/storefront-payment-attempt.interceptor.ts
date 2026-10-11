import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ConfigService, internal_getRequestContext, parseContext, UserInputError } from '@vendure/core';
import { from, lastValueFrom } from 'rxjs';

import {
    StorefrontPaymentAttemptInput,
    StorefrontPaymentAttemptService,
} from './storefront-payment-attempt.service';

@Injectable()
export class StorefrontPaymentAttemptInterceptor implements NestInterceptor {
    constructor(
        private readonly attempts: StorefrontPaymentAttemptService,
        private readonly config: ConfigService,
    ) {}

    async intercept(context: ExecutionContext, next: CallHandler) {
        const parsed = parseContext(context);
        if (
            !parsed.isGraphQL ||
            parsed.info.parentType.name !== 'Mutation' ||
            !['addPaymentToOrder', 'useMyReferralBalance'].includes(parsed.info.fieldName)
        )
            return next.handle();
        const ctx = internal_getRequestContext(parsed.req, context);
        if (ctx.apiType !== 'shop') return next.handle();
        const args = GqlExecutionContext.create(context).getArgs();
        const balance = parsed.info.fieldName === 'useMyReferralBalance';
        const input = balance ? args.paymentAttempt : args.input?.metadata?.storefrontPaymentAttempt;
        if (input === undefined || input === null) {
            // Older clients retain the original flow, but cannot bypass a new unresolved claim.
            await this.attempts.assertNoUnresolvedAttempt(ctx);
            return next.handle();
        }
        if (
            input.kind !== (balance ? 'balance' : 'payment') ||
            input.method !== (balance ? 'referral-balance' : args.input?.method) ||
            (balance && input.amount !== args.amount)
        )
            throw new UserInputError('INVALID_PAYMENT_REQUEST');
        return from(
            this.attempts.execute(
                ctx,
                balance
                    ? (input as StorefrontPaymentAttemptInput)
                    : {
                          ...input,
                          // JSON metadata bypasses Vendure's typed GraphQL ID decoder.
                          orderId: (
                              this.config.entityOptions.entityIdStrategy ?? this.config.entityIdStrategy
                          ).decodeId(String(input.orderId)),
                      },
                async () => await lastValueFrom(next.handle()),
            ),
        );
    }
}
