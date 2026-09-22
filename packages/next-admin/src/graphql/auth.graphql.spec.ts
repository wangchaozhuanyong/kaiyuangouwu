import { print } from 'graphql';
import { describe, expect, it } from 'vitest';

import {
    APP_SHELL_BOOTSTRAP_QUERY,
    APP_SHELL_COMMERCE_CONTEXT_QUERY,
    APP_SHELL_PROFILE_CONTEXT_QUERY,
} from './auth.graphql';

describe('app shell GraphQL boundaries', () => {
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
