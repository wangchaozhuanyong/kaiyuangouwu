import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// Exercise the qs resolved by the production HTTP stack, including the root override.
const requireFromExpress = createRequire(require.resolve('express'));
const qs: typeof import('qs') = requireFromExpress('qs');

describe('HTTP query parser dependency security', () => {
    // GHSA-x5fp-wj9c-mxmx
    it.each(['tags', 'tags[]', 'tags[0]', 'tags[nested]'])(
        'enforces comma-separated array limits for %s keys',
        key => {
            expect(() =>
                qs.parse(`${key}=one,two,three,four`, {
                    comma: true,
                    arrayLimit: 3,
                    throwOnLimitExceeded: true,
                }),
            ).toThrow(RangeError);
        },
    );

    it('preserves in-limit bracket groups and the default non-throwing behavior', () => {
        expect(
            qs.parse('tags[]=one,two', { comma: true, arrayLimit: 3, throwOnLimitExceeded: true }),
        ).toEqual({ tags: [['one', 'two']] });
        expect(qs.parse('tags[]=one,two,three,four', { comma: true, arrayLimit: 3 })).toEqual({
            tags: [['one', 'two', 'three', 'four']],
        });
    });

    // GHSA-4mjr-xmp4-gh2g
    it.each([{ plainObjects: true }, { allowPrototypes: true }])(
        'safely serializes parsed constructor data with %j',
        options => {
            const parsed = qs.parse('item[constructor][isBuffer]=not-a-function&name=example', options);

            expect(() => qs.stringify(parsed)).not.toThrow();
            expect(qs.stringify(parsed)).toContain('name=example');
        },
    );

    it('preserves ordinary nested filters and repeated query values', () => {
        const filters = { filter: { enabled: 'true' }, tags: ['one', 'two'] };

        expect(qs.parse(qs.stringify(filters))).toEqual(filters);
        expect(qs.parse('tags=one&tags=two')).toEqual({ tags: ['one', 'two'] });
        expect(qs.stringify({ value: Buffer.from('example') })).toBe('value=example');
    });
});
