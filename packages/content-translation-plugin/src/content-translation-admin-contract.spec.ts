import { Permission } from '@vendure/core';
import { PERMISSIONS_METADATA_KEY } from '@vendure/core/dist/api/decorators/allow.decorator';
import { buildASTSchema, concatAST, parse, validate } from 'graphql';
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

import {
    CONFIRM_CONTENT_TRANSLATION_REVIEW_MUTATION,
    CONTENT_TRANSLATION_REVIEW_QUERY,
} from '../../next-admin/src/graphql/plugins.graphql';

import { adminApiExtensions } from './api-extensions.js';
import { ContentTranslationAdminResolver } from './content-translation.resolver.js';

describe('translation admin API contract', () => {
    const schema = buildASTSchema(
        concatAST([
            parse('scalar DateTime\ntype Query { _empty: Boolean }\ntype Mutation { _empty: Boolean }'),
            adminApiExtensions,
        ]),
    );
    it.each([CONTENT_TRANSLATION_REVIEW_QUERY, CONFIRM_CONTENT_TRANSLATION_REVIEW_MUTATION])(
        'accepts the actual admin review documents',
        document => expect(validate(schema, document)).toEqual([]),
    );
    it.each([
        'contentTranslationReview',
        'confirmCustomerContentTranslationReview',
        'contentTranslationRecoveryPreview',
        'recoverCustomerContentTranslations',
    ] as const)('keeps %s behind the existing SuperAdmin permission', field => {
        expect(
            Reflect.getMetadata(
                PERMISSIONS_METADATA_KEY,
                Object.getOwnPropertyDescriptor(ContentTranslationAdminResolver.prototype, field)?.value,
            ),
        ).toEqual([Permission.SuperAdmin]);
    });
    it('does not write or reset workers during a recovery preview', async () => {
        const preview = vi.fn().mockResolvedValue({ total: 0, records: [] });
        const reset = vi.fn();
        const resolver = new ContentTranslationAdminResolver(
            {} as any,
            {} as any,
            {} as any,
            { reset } as any,
            {} as any,
            { preview } as any,
        );
        await expect(
            resolver.contentTranslationRecoveryPreview({ channelId: '1' } as any, {}),
        ).resolves.toEqual({ total: 0, records: [] });
        expect(preview).toHaveBeenCalledWith({ channelId: '1' }, 100, 0);
        expect(reset).not.toHaveBeenCalled();
    });
});
