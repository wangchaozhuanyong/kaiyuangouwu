import { describe, expect, it } from 'vitest';

import {
    autoCardFieldLabel,
    maskAutoCardValues,
    normalizeAutoCardDelimiter,
    parseAutoCardRows,
    validateAutoCardFields,
} from './auto-card-format';

const fields = [
    { key: 'account', label: '账号', labelEn: 'Account', secret: false },
    { key: 'password', label: '密码', labelEn: 'Password', secret: true },
    { key: 'twoFactor', label: '2FA密钥', labelEn: '2FA code', secret: true },
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
                rawPayload: 'first@example.com----pass-1----seed-1',
                values: { account: 'first@example.com', password: 'pass-1', twoFactor: 'seed-1' },
            },
            {
                lineNumber: 2,
                rawPayload: 'second@example.com----pass-2----seed-2',
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

    it('backfills common English labels and localizes email fields', () => {
        const [field] = validateAutoCardFields([
            { key: 'emailPassword', label: '邮箱密码', secret: true } as (typeof fields)[number],
        ]);
        expect(field.labelEn).toBe('Email password');
        expect(autoCardFieldLabel(field, true)).toBe('邮箱密码');
        expect(autoCardFieldLabel(field, false)).toBe('Email password');
    });

    it('does not expose legacy Chinese field labels on the English storefront', () => {
        const legacyField = { key: 'account', label: '账号', labelEn: '账号', secret: false };

        expect(validateAutoCardFields([legacyField])[0].labelEn).toBe('Account');
        expect(autoCardFieldLabel(legacyField, false)).toBe('Account');
    });
});
