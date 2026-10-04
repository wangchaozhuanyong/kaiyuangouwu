import { subscribeAdminFeedback } from '../utils/admin-feedback';
import { refreshAfterAdminWrite } from '../utils/admin-write-readback';
// @vitest-environment jsdom
import { ApolloClient, ApolloLink, gql, InMemoryCache, Observable } from '@apollo/client';
import type { FormattedExecutionResult } from 'graphql';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminReadTimeoutLink } from './admin-read-timeout';
import {
    createResourceInvalidationLink,
    pendingAdminWrites,
    RESOURCE_INVALIDATION_EVENT,
    resourceDomains,
    resourceMatchesDomains,
} from './admin-resource-events';

const mutation = gql`
    mutation CreateProduct {
        createProduct {
            __typename
            id
        }
    }
`;
const query = gql`
    query Product {
        product {
            id
        }
    }
`;
function execute(link: ApolloLink, document = mutation, context = {}) {
    return ApolloLink.execute(link, { query: document, context }, { client: {} as never });
}
afterEach(() => vi.useRealTimers());

describe('accepted writes and bounded reads', () => {
    it.each([
        ['updateManagedAdministrator', 'activeAdministrator', 'settings'],
        ['updateMyStoreCommerceConfiguration', 'myStoreCommerceMode', 'settings'],
        ['runScheduledTask', 'scheduledTasks', 'settings'],
        ['createSystemAnnouncement', 'systemAnnouncements', 'storefront'],
        ['saveImageModel', 'imageModels', 'plugins'],
        ['publishManualDigitalDelivery', 'order', 'orders'],
        ['setDataRetentionLegalHold', 'dataRetentionRecords', 'settings'],
    ])('connects accepted %s writes to dependent %s reads', (field, read, domain) => {
        const document = gql(`mutation Mapping { ${field} { id } }`);
        const domains = resourceDomains(document);
        expect(domains).toContain(domain);
        expect(resourceMatchesDomains(`query Dependent { ${read} { id } }`, domains)).toBe(true);
    });

    it('leaves session-transition redirects and cache handling to the existing auth flow', () => {
        expect(
            resourceDomains(gql`
                mutation Login {
                    adminVerifyLoginTwoFactor {
                        id
                    }
                }
            `),
        ).toEqual([]);
    });

    it('returns an accepted mutation receipt when a subsequent real Apollo read fails', async () => {
        const operations: string[] = [];
        const feedback = vi.fn();
        const stop = subscribeAdminFeedback(feedback);
        const client = new ApolloClient({
            cache: new InMemoryCache(),
            link: new ApolloLink(
                operation =>
                    new Observable(observer => {
                        operations.push(operation.operationName ?? 'anonymous');
                        if (operation.operationName === 'CreateProduct') {
                            observer.next({ data: { createProduct: { __typename: 'Product', id: '1' } } });
                            observer.complete();
                        } else observer.error(new Error('readback unavailable'));
                    }),
            ),
        });
        try {
            const receipt = await client.mutate<{ createProduct: { id: string } }>({ mutation });
            await refreshAfterAdminWrite(() => client.query({ query, fetchPolicy: 'network-only' }));
            expect(receipt.data?.createProduct.id).toBe('1');
            expect(operations).toEqual(['CreateProduct', 'Product']);
            expect(feedback.mock.calls[0][0]).toMatchObject({
                kind: 'info',
                title: '操作已完成，数据更新失败',
            });
        } finally {
            stop();
            client.stop();
        }
    });

    it('invalidates once after a successful write and releases its pending state', () => {
        let observer: any;
        const events = vi.fn();
        window.addEventListener(RESOURCE_INVALIDATION_EVENT, events);
        const end = new ApolloLink(
            () =>
                new Observable<FormattedExecutionResult>(value => {
                    observer = value;
                }),
        );
        const subscription = execute(createResourceInvalidationLink(() => 'store-a').concat(end)).subscribe(
            {},
        );
        expect(pendingAdminWrites()).toBe(1);
        observer.next({ data: { createProduct: { __typename: 'Product', id: '1' } } });
        observer.next({ data: { createProduct: { __typename: 'Product', id: '1' } } });
        observer.complete();
        expect(events).toHaveBeenCalledTimes(1);
        expect((events.mock.calls[0][0] as CustomEvent).detail.domains).toContain('catalog');
        expect(pendingAdminWrites()).toBe(0);
        subscription.unsubscribe();
        window.removeEventListener(RESOURCE_INVALIDATION_EVENT, events);
    });
    it('does not invalidate rejected or old-scope writes and never replays them', () => {
        const events = vi.fn();
        let scope = 'a';
        let observer: any;
        const forward = vi.fn(
            () =>
                new Observable<FormattedExecutionResult>(value => {
                    observer = value;
                }),
        );
        window.addEventListener(RESOURCE_INVALIDATION_EVENT, events);
        const stream = execute(createResourceInvalidationLink(() => scope).concat(new ApolloLink(forward)));
        const first = stream.subscribe({});
        observer.next({ errors: [{ message: 'rejected' }] });
        observer.complete();
        const second = stream.subscribe({});
        scope = 'b';
        observer.next({ data: { createProduct: { __typename: 'Product', id: '1' } } });
        observer.complete();
        expect(events).not.toHaveBeenCalled();
        expect(forward).toHaveBeenCalledTimes(2);
        expect(pendingAdminWrites()).toBe(0);
        first.unsubscribe();
        second.unsubscribe();
        window.removeEventListener(RESOURCE_INVALIDATION_EVENT, events);
    });
    it('releases write state even when forwarding throws synchronously', () => {
        const error = vi.fn();
        execute(
            createResourceInvalidationLink(() => 'a').concat(
                new ApolloLink(() => {
                    throw new Error('transport setup');
                }),
            ),
        ).subscribe({ error });
        expect(error).toHaveBeenCalledOnce();
        expect(pendingAdminWrites()).toBe(0);
    });
    it('times out only managed reads without cancelling or repeating a write', async () => {
        vi.useFakeTimers();
        const cancelled = vi.fn(),
            forward = vi.fn(() => new Observable<FormattedExecutionResult>(() => cancelled));
        const link = adminReadTimeoutLink.concat(new ApolloLink(forward));
        const error = vi.fn();
        const read = execute(link, query, { adminManagedRead: true }).subscribe({ error });
        const write = execute(link, mutation, { adminManagedRead: true }).subscribe({});
        await vi.advanceTimersByTimeAsync(45_001);
        expect(error).toHaveBeenCalledOnce();
        expect(error.mock.calls[0][0].extensions.code).toBe('TIMEOUT');
        expect(cancelled).toHaveBeenCalledTimes(1);
        expect(forward).toHaveBeenCalledTimes(2);
        write.unsubscribe();
        read.unsubscribe();
    });
});
