import { buildASTSchema, Kind, parse, print, validate } from 'graphql';
import { describe, expect, it } from 'vitest';

import { adminApiExtensions } from '../../../store-management-plugin/src/api-extensions';

import {
    APP_SHELL_BOOTSTRAP_QUERY,
    APP_SHELL_COMMERCE_CONTEXT_QUERY,
    APP_SHELL_PROFILE_CONTEXT_QUERY,
} from './auth.graphql';

describe('app shell GraphQL boundaries', () => {
    it('validates the profile read against the server StoreProfile fields', () => {
        const profile = adminApiExtensions.definitions.find(
            definition =>
                definition.kind === Kind.OBJECT_TYPE_DEFINITION && definition.name.value === 'StoreProfile',
        );
        if (!profile || profile.kind !== Kind.OBJECT_TYPE_DEFINITION)
            throw new Error('StoreProfile schema missing');
        const schema = buildASTSchema({
            kind: Kind.DOCUMENT,
            definitions: [
                ...parse(`
                    interface Node { id: ID! }
                    type Channel { id: ID! }
                    type Asset { id: ID!, preview: String! }
                    type Query { myStoreProfile: StoreProfile }
                `).definitions,
                {
                    ...profile,
                    fields: profile.fields?.filter(field =>
                        ['id', 'channel', 'logoAsset'].includes(field.name.value),
                    ),
                },
            ],
        });

        expect(validate(schema, APP_SHELL_PROFILE_CONTEXT_QUERY)).toEqual([]);
    });
    it('keeps optional store context out of the permission bootstrap query', () => {
        const bootstrapQuery = print(APP_SHELL_BOOTSTRAP_QUERY);
        const commerceContextQuery = print(APP_SHELL_COMMERCE_CONTEXT_QUERY);
        const profileContextQuery = print(APP_SHELL_PROFILE_CONTEXT_QUERY);

        expect(bootstrapQuery).not.toContain('myStoreProfile');
        expect(bootstrapQuery).not.toContain('myStoreCommerceMode');
        expect(bootstrapQuery).toContain('manageableChannels');
        expect(bootstrapQuery).not.toContain('channels(options:');
        expect(commerceContextQuery).toContain('myStoreCommerceMode');
        expect(commerceContextQuery).not.toContain('myStoreProfile');
        expect(profileContextQuery).toContain('myStoreProfile');
        expect(profileContextQuery).not.toContain('myStoreCommerceMode');
    });
});
