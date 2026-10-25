import { describe, expect, it } from 'vitest';
import { customerFilter } from './customer-search';

describe('customer search across stored name fields', () => {
    it('matches the displayed full name without removing email/phone/individual name searches', () => {
        const filter = customerFilter(' www ');
        expect(filter?._or).toContainEqual({
            _and: [{ lastName: { eq: 'w' } }, { firstName: { eq: 'ww' } }],
        });
        expect(filter?._or).toContainEqual({ emailAddress: { contains: 'www' } });
        expect(filter?._or).toContainEqual({ phoneNumber: { contains: 'www' } });
        expect(filter?._or).toContainEqual({ firstName: { contains: 'www' } });
        expect(filter?._or).toContainEqual({ lastName: { contains: 'www' } });
    });
    it.each([
        ['王小明', '王', '小明'],
        ['Li Ming', 'Li', 'Ming'],
        ['张😀', '张', '😀'],
    ])(
        'supports a complete name %s, including a surname/name separator and Unicode',
        (name, lastName, firstName) => {
            expect(customerFilter(name)?._or).toContainEqual({
                _and: [{ lastName: { eq: lastName } }, { firstName: { eq: firstName } }],
            });
        },
    );
    it('leaves empty and email searches on the existing path', () => {
        expect(customerFilter('  ')).toBeUndefined();
        expect(customerFilter('buyer@example.invalid')?._or).toHaveLength(4);
    });
});
