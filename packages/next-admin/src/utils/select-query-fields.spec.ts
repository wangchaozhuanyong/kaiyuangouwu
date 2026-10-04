import { buildSchema, parse, print, validate } from 'graphql';
import { describe, expect, it } from 'vitest';
import { mergeQueryLists } from './merge-query-lists';
import { selectQueryFields } from './select-query-fields';
const schema = buildSchema(
    `type Query { jobs(state: String): [Item!]! apiKeys: [Item!]! } type Item { id: ID! label(language: String): String! }`,
);
const query = parse(
    `query Center($state:String,$language:String,$unused:Int) { jobs(state:$state) { ...ItemFields } apiKeys {id} } fragment ItemFields on Item { id ...Label } fragment Label on Item { label(language:$language) } fragment Unused on Item {id}`,
);
describe('independent page reads', () => {
    it('retains recursive fragments and only variables used by this page', () => {
        const jobs = selectQueryFields(query, ['jobs']);
        expect(validate(schema, jobs)).toEqual([]);
        expect(print(jobs)).not.toContain('apiKeys');
        expect(print(jobs)).not.toContain('$unused');
        expect(print(jobs)).toContain('$language');
        expect(print(jobs)).not.toContain('fragment Unused');
        expect(selectQueryFields(query, ['jobs'])).toBe(jobs);
        const keys = selectQueryFields(query, ['apiKeys']);
        expect(validate(schema, keys)).toEqual([]);
        expect(print(keys)).not.toContain('fragment');
        expect(print(keys)).not.toContain('$state');
        expect(print(keys)).not.toContain('$language');
    });
    it('does not combine independent document selections or mutate the source', () => {
        expect(print(query)).toContain('apiKeys');
        expect(print(selectQueryFields(query, ['jobs']))).not.toContain('apiKeys');
        expect(print(selectQueryFields(query, ['apiKeys']))).not.toContain('jobs');
    });
    it('merges selected pagination fields without requiring omitted lists', () => {
        const prev = { sellers: { items: [{ id: '1', name: 'old' }], totalItems: 2 } };
        const next = {
            sellers: {
                items: [
                    { id: '1', name: 'updated' },
                    { id: '2', name: 'next' },
                ],
                totalItems: 2,
            },
        };
        expect(mergeQueryLists(prev, next, ['sellers', 'paymentMethods'])).toEqual({
            sellers: {
                items: [
                    { id: '1', name: 'updated' },
                    { id: '2', name: 'next' },
                ],
                totalItems: 2,
            },
        });
    });
});
