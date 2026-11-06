import { ApolloServer } from '@apollo/server';
import { buildSchema } from 'graphql';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { QueryComplexityPlugin } from './query-complexity-plugin';

// Apollo and the complexity calculator both use GraphQL's CommonJS entry point.
vi.mock('graphql', async () => {
    const { createRequire } = await import('node:module');
    return createRequire(import.meta.url)('graphql');
});

const schema = buildSchema(`
    interface PaginatedList { totalItems: Int! }
    input ListOptions { take: Int }
    type Item { id: ID!, name: String! }
    type ItemList implements PaginatedList { totalItems: Int!, items: [Item!]! }
    type Query { items(options: ListOptions): ItemList }
`);

describe('Shop API query complexity', () => {
    const server = new ApolloServer({
        schema,
        plugins: [new QueryComplexityPlugin({ maxQueryComplexity: 100 })],
    });

    afterAll(async () => {
        await server.stop();
    });

    it('rejects expensive selections even when a sibling supplies a negative take', async () => {
        const queries = [
            { query: '{ items(options: { take: 100 }) { items { id name } } }' },
            {
                query: `{
                    cost: items(options: { take: 100 }) { items { id name } }
                    offset: items(options: { take: -100 }) { items { id name } }
                }`,
            },
            {
                query: `query List($take: Int!) {
                    cost: items(options: { take: 100 }) { ...Items }
                    offset: items(options: { take: $take }) { ...Items }
                }
                fragment Items on ItemList { items { id name } }`,
                variables: { take: -100 },
            },
            { query: '{ items(options: { take: 2147483647 }) { items { id } } }' },
        ];

        for (const request of queries) {
            const result = await server.executeOperation(request);
            expect(result.body.kind).toBe('single');
            if (result.body.kind === 'single') {
                expect(result.body.singleResult.errors?.[0].message).toBe('Query is too complex');
            }
        }
    });

    it('accepts a bounded list and preserves zero and negative take behavior', async () => {
        for (const take of [5, 0, -5]) {
            const result = await server.executeOperation({
                query: 'query List($take: Int!) { items(options: { take: $take }) { items { id } } }',
                variables: { take },
            });
            expect(result.body.kind).toBe('single');
            if (result.body.kind === 'single') {
                expect(result.body.singleResult.errors).toBeUndefined();
            }
        }
    });
});
