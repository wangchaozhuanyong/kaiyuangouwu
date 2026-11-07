// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable, gql } from '@apollo/client';
import { GraphQLError } from 'graphql';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
    ADMIN_SESSION_REVALIDATION_EVENT,
    clearAuthSession,
    getAdminQueryScope,
    sessionRevalidationLink,
    setInitialActiveChannel,
} from './apollo';

const events = vi.fn();
const clients: ApolloClient[] = [];
beforeEach(() => {
    events.mockClear();
    setInitialActiveChannel('fixture-a');
    window.addEventListener(ADMIN_SESSION_REVALIDATION_EVENT, events);
});
afterEach(() => {
    window.removeEventListener(ADMIN_SESSION_REVALIDATION_EVENT, events);
    clients.splice(0).forEach(client => client.stop());
    clearAuthSession();
});
const query = gql`
    query SessionGuardFixture {
        globalSettings {
            id
        }
    }
`;
async function read(path: string[], name = query, beforeResult?: () => void) {
    const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: ApolloLink.from([
            sessionRevalidationLink,
            new ApolloLink(
                () =>
                    new Observable(observer => {
                        beforeResult?.();
                        observer.next({
                            data: null,
                            errors: [
                                new GraphQLError('你当前无权执行此操作', {
                                    path,
                                    extensions: { code: 'FORBIDDEN' },
                                }),
                            ],
                        });
                        observer.complete();
                    }),
            ),
        ]),
    });
    clients.push(client);
    return client.query({ query: name, fetchPolicy: 'network-only', errorPolicy: 'all' });
}
it('requests a scoped identity check for rejected authenticated configuration while retaining the original error', async () => {
    const result = await read(['globalSettings']);
    expect(result.error).toBeDefined();
    expect(events).toHaveBeenCalledOnce();
    expect(events.mock.calls[0][0].detail).toEqual({ scope: getAdminQueryScope() });
});
it('does not reinterpret genuine business permissions or recursively recheck its own identity probe', async () => {
    await read(['products']);
    await read(
        ['me'],
        gql`
            query GetAdminSession {
                me {
                    id
                }
            }
        `,
    );
    expect(events).not.toHaveBeenCalled();
});
it('ignores a late configuration denial after switching stores', async () => {
    await read(['globalSettings'], query, () => setInitialActiveChannel('fixture-b'));
    expect(events).not.toHaveBeenCalled();
});
it('does not interrupt intentional session clearing while one-time recovery codes are acknowledged', async () => {
    clearAuthSession();
    await read(['globalSettings']);
    expect(events).not.toHaveBeenCalled();
});
