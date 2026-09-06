import { Inject, Injectable } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';
import { randomUUID } from 'node:crypto';
import { IsNull, LessThanOrEqual, MoreThan } from 'typeorm';

import { CONTENT_TRANSLATION_OPTIONS } from './constants.js';
import { TranslationProviderState } from './entities/translation-provider-state.entity.js';
import { TranslationProviderError } from './translation-provider-error.js';
import { ContentTranslationPluginOptions, ContentTranslationRequest } from './types.js';

export const translationBackoff = (attempts: number) =>
    Math.min(900_000, 60_000 * 2 ** Math.min(4, Math.max(0, attempts - 1)));

/** The only entry point allowed to invoke the external translation provider. */
@Injectable()
export class TranslationExecutionService {
    constructor(
        private readonly connection: TransactionalConnection,
        @Inject(CONTENT_TRANSLATION_OPTIONS)
        private readonly options: Required<ContentTranslationPluginOptions>,
    ) {}

    async state() {
        const repository = this.connection.rawConnection.getRepository(TranslationProviderState);
        await repository
            .createQueryBuilder()
            .insert()
            .values({ provider: this.options.provider.name })
            .orIgnore()
            .execute();
        return repository.findOneByOrFail({ provider: this.options.provider.name });
    }

    async reset() {
        await this.state();
        await this.connection.rawConnection
            .getRepository(TranslationProviderState)
            .update(
                { provider: this.options.provider.name, blocked: true },
                { blocked: false, attempts: 0, nextAttemptAt: new Date(Date.now()), lastErrorCode: null },
            );
    }

    async translate(request: ContentTranslationRequest) {
        const state = await this.state();
        const repository = this.connection.rawConnection.getRepository(TranslationProviderState);
        const now = new Date(Date.now());
        if (state.blocked) throw new TranslationProviderError('CONFIGURATION');
        const token = randomUUID();
        const criteria = [IsNull(), LessThanOrEqual(now)].flatMap(leaseUntil =>
            [IsNull(), LessThanOrEqual(now)].map(nextAttemptAt => ({
                provider: state.provider,
                blocked: false,
                leaseUntil,
                nextAttemptAt,
            })),
        );
        const acquired = await repository.update(criteria, {
            leaseToken: token,
            leaseUntil: new Date(now.getTime() + 30_000),
        });
        if (!acquired.affected)
            throw new TranslationProviderError(
                'BUSY',
                Math.max(1000, (state.nextAttemptAt?.getTime() ?? 0) - now.getTime()),
            );
        try {
            if (!this.options.provider.isConfigured()) throw new TranslationProviderError('CONFIGURATION');
            const result = await this.options.provider.translate(request);
            const released = await repository.update(
                { provider: state.provider, leaseToken: token, leaseUntil: MoreThan(new Date(Date.now())) },
                {
                    leaseToken: null,
                    leaseUntil: null,
                    attempts: 0,
                    lastErrorCode: null,
                    nextAttemptAt: new Date(Date.now() + 1000),
                },
            );
            if (!released.affected) throw new TranslationProviderError('BUSY', 60_000);
            return result;
        } catch (error) {
            const failure =
                error instanceof TranslationProviderError
                    ? error
                    : new TranslationProviderError('UNAVAILABLE');
            const providerWide = ['RATE_LIMIT', 'QUOTA', 'UNAVAILABLE', 'CONFIGURATION'].includes(
                failure.code,
            );
            await repository.update(
                { provider: state.provider, leaseToken: token },
                {
                    leaseToken: null,
                    leaseUntil: null,
                    attempts: providerWide ? state.attempts + 1 : 0,
                    blocked: failure.code === 'CONFIGURATION',
                    lastErrorCode: providerWide ? failure.code : null,
                    nextAttemptAt: new Date(
                        Date.now() +
                            (providerWide
                                ? Math.max(translationBackoff(state.attempts + 1), failure.retryAfterMs ?? 0)
                                : 1000),
                    ),
                },
            );
            throw failure;
        }
    }
}
