import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { getOperationAST, Kind } from 'graphql';
import { describe, expect, it } from 'vitest';
import {
    CONFIRM_LEGACY_SHIPPING_METHOD_OWNERSHIP_MUTATION,
    COPY_LEGACY_SHIPPING_METHOD_MUTATION,
    COPY_PLATFORM_SHIPPING_TEMPLATE_MUTATION,
    CREATE_PLATFORM_FREE_SHIPPING_VERSION_MUTATION,
    INITIALIZE_PLATFORM_SHIPPING_TEMPLATES_MUTATION,
    SET_MY_SHIPPING_TEMPLATE_ENABLED_MUTATION,
    SHIPPING_TEMPLATE_MANAGEMENT_QUERY,
} from './management.graphql';

describe('shipping template operation documents', () => {
    it('executes the real Apollo shipping read without a multiple-operation invariant', async () => {
        const shippingTemplateManagement = {
            isPlatform: true,
            missingPlatformTemplates: 1,
            latestPlatformVersion: 0,
            adoptedPlatformTemplateId: null,
            items: [],
        };
        const client = new ApolloClient({
            cache: new InMemoryCache(),
            link: new ApolloLink(
                () =>
                    new Observable(observer => {
                        observer.next({ data: { shippingTemplateManagement } });
                        observer.complete();
                    }),
            ),
        });
        try {
            const result = await client.query({
                query: SHIPPING_TEMPLATE_MANAGEMENT_QUERY,
                fetchPolicy: 'no-cache',
            });
            expect(result.data).toEqual({ shippingTemplateManagement });
        } finally {
            client.stop();
        }
    });
    it.each([
        ['query', SHIPPING_TEMPLATE_MANAGEMENT_QUERY],
        ['mutation', INITIALIZE_PLATFORM_SHIPPING_TEMPLATES_MUTATION],
        ['mutation', SET_MY_SHIPPING_TEMPLATE_ENABLED_MUTATION],
        ['mutation', CREATE_PLATFORM_FREE_SHIPPING_VERSION_MUTATION],
        ['mutation', COPY_PLATFORM_SHIPPING_TEMPLATE_MUTATION],
        ['mutation', CONFIRM_LEGACY_SHIPPING_METHOD_OWNERSHIP_MUTATION],
        ['mutation', COPY_LEGACY_SHIPPING_METHOD_MUTATION],
    ] as const)('keeps one executable %s when interpolating the shipping fragment', (operation, document) => {
        expect(
            document.definitions.filter(definition => definition.kind === Kind.OPERATION_DEFINITION),
        ).toHaveLength(1);
        expect(getOperationAST(document)?.operation).toBe(operation);
        expect(
            document.definitions
                .filter(definition => definition.kind === Kind.FRAGMENT_DEFINITION)
                .map(definition => definition.name.value),
        ).toContain('NextAdminShippingMethodManagementFields');
    });
});
