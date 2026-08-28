import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const i18nDirectory = path.join(__dirname, 'i18n');

function explicitIds(fileName: string): Set<string> {
    const catalog = readFileSync(path.join(i18nDirectory, fileName), 'utf8');
    return new Set(
        [...catalog.matchAll(/#\. js-lingui-explicit-id\nmsgid "([^"]+)"/g)].map(match => match[1]),
    );
}

describe('2FA dashboard translations', () => {
    it('keeps every Simplified Chinese message marked as an explicit Lingui id', () => {
        const source = readFileSync(path.join(__dirname, 'messages.ts'), 'utf8');
        const sourceIds = new Set([...source.matchAll(/id:\s*'([^']+)'/g)].map(match => match[1]));
        expect(explicitIds('zh_Hans.po')).toEqual(sourceIds);
    });

    it('includes English navigation labels because navigation resolves ids without fallback copy', () => {
        const ids = explicitIds('en.po');
        expect(ids).toContain('twoFactor.nav.section');
        expect(ids).toContain('twoFactor.title');
    });
});
