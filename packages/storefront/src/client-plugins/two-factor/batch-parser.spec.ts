import { describe, expect, it } from 'vitest';

import { parseBatchImport } from './batch-parser';

describe('storefront 2FA batch import', () => {
    it('accepts named and key-only rows with a localized fallback name', () => {
        const result = parseBatchImport(
            ['客服账号 01 | JBSWY3DPEHPK3PXP', 'GEZDGNBVGY3TQOJQ'].join('\n'),
            [],
            100,
            'Untitled',
        );
        expect(result.errors).toEqual([]);
        expect(result.accounts[1]).toMatchObject({ projectName: 'Untitled-001' });
    });

    it('reports malformed, duplicate, and over-limit rows without returning their values', () => {
        const invalid = parseBatchImport('项目一 | NOT-A-SECRET!', ['JBSWY3DPEHPK3PXP']);
        expect(invalid).toEqual({
            accounts: [],
            errors: [{ lineNumber: 1, code: 'INVALID_SECRET' }],
        });

        const limited = parseBatchImport(
            ['项目一 | JBSWY3DPEHPK3PXP', '项目二 | GEZDGNBVGY3TQOJQ'].join('\n'),
            [],
            1,
        );
        expect(limited.accounts).toHaveLength(1);
        expect(limited.errors).toEqual([{ lineNumber: 2, code: 'LIMIT_REACHED' }]);
    });
});
