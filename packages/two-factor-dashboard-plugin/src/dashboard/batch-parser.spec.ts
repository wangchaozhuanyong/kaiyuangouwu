import { describe, expect, it } from 'vitest';

import { parseBatchImport } from './batch-parser';

describe('parseBatchImport', () => {
    it('accepts named rows and key-only rows', () => {
        const result = parseBatchImport(['ChatGPT-客服01 | JBSWY3DPEHPK3PXP', 'GEZDGNBVGY3TQOJQ'].join('\n'));
        expect(result.errors).toEqual([]);
        expect(result.accounts).toEqual([
            {
                lineNumber: 1,
                projectName: 'ChatGPT-客服01',
                secret: 'JBSWY3DPEHPK3PXP',
            },
            {
                lineNumber: 2,
                projectName: '未命名-001',
                secret: 'GEZDGNBVGY3TQOJQ',
            },
        ]);
    });

    it('reports malformed and duplicate rows without exposing their values', () => {
        const result = parseBatchImport(['项目一 | NOT-A-SECRET!', '项目二 | JBSWY3DPEHPK3PXP'].join('\n'), [
            'JBSWY3DPEHPK3PXP',
        ]);
        expect(result.accounts).toEqual([]);
        expect(result.errors).toEqual([
            { lineNumber: 1, code: 'INVALID_SECRET' },
            { lineNumber: 2, code: 'DUPLICATE_SECRET' },
        ]);
    });

    it('enforces the total account limit', () => {
        const result = parseBatchImport(
            ['项目一 | JBSWY3DPEHPK3PXP', '项目二 | GEZDGNBVGY3TQOJQ'].join('\n'),
            [],
            1,
        );
        expect(result.accounts).toHaveLength(1);
        expect(result.errors).toEqual([{ lineNumber: 2, code: 'LIMIT_REACHED' }]);
    });
});
