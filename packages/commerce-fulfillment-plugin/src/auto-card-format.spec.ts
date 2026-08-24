import { describe, expect, it } from 'vitest';

import { maskAutoCardValues, normalizeAutoCardDelimiter, parseAutoCardRows } from './auto-card-format';

const fields = [
    { key: 'account', label: '账号', secret: false },
    { key: 'password', label: '密码', secret: true },
    { key: 'twoFactor', label: '2FA密钥', secret: true },
];

describe('auto card format', () => {
    it('parses one credential per line using the configured field order', () => {
        const result = parseAutoCardRows(
            'first@example.com----pass-1----seed-1\nsecond@example.com----pass-2----seed-2',
            fields,
            '----',
        );

        expect(result.errors).toEqual([]);
        expect(result.rows).toEqual([
            {
                lineNumber: 1,
                values: { account: 'first@example.com', password: 'pass-1', twoFactor: 'seed-1' },
            },
            {
                lineNumber: 2,
                values: { account: 'second@example.com', password: 'pass-2', twoFactor: 'seed-2' },
            },
        ]);
    });

    it('reports invalid column counts without importing partial rows', () => {
        const result = parseAutoCardRows('account----password', fields, '----');
        expect(result.rows).toEqual([]);
        expect(result.errors[0].message).toContain('预期 3 个字段');
    });

    it('supports tab-separated values copied from spreadsheets', () => {
        expect(normalizeAutoCardDelimiter('TAB')).toBe('\t');
        expect(parseAutoCardRows('account\tpassword\tseed', fields, '\\t').rows).toHaveLength(1);
    });

    it('masks secrets and identifiers for list views', () => {
        const masked = maskAutoCardValues(
            { account: 'someone@example.com', password: 'visible-password', twoFactor: 'seed' },
            fields,
        );
        expect(masked[0].value).toBe('so***@example.com');
        expect(masked[1].value).not.toContain('visible-password');
        expect(masked[2].value).not.toContain('seed');
    });
});
