import { print } from 'graphql';
import { describe, expect, it } from 'vitest';

import { APP_SHELL_BOOTSTRAP_QUERY, APP_SHELL_STORE_CONTEXT_QUERY } from './auth.graphql';

describe('app shell GraphQL boundaries', () => {
    it('keeps optional store context out of the permission bootstrap query', () => {
        const bootstrapQuery = print(APP_SHELL_BOOTSTRAP_QUERY);
        const storeContextQuery = print(APP_SHELL_STORE_CONTEXT_QUERY);

        expect(bootstrapQuery).not.toContain('myStoreProfile');
        expect(bootstrapQuery).not.toContain('myStoreCommerceMode');
        expect(storeContextQuery).toContain('myStoreProfile');
        expect(storeContextQuery).toContain('myStoreCommerceMode');
    });
});
