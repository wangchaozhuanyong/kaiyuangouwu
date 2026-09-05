import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXCLUDED_PATHS = [
    'pages/Auth/LoginModule.tsx',
    'pages/Auth/InitialPasswordChangeModule.tsx',
    'custom-fields/CustomFieldsProvider.tsx',
    'components/FeatureHelp.tsx',
];
const NON_FUNCTIONAL_TITLE =
    /(失败|没有|不存在|无权访问|暂不可用|暂无|还没有|确认永久删除|当前登录会话|未配置|加载失败|^规则包 v$)/;

function tsxFiles(directory: string): string[] {
    return readdirSync(directory).flatMap(name => {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) return tsxFiles(path);
        return name.endsWith('.tsx') && !name.endsWith('.spec.tsx') ? [path] : [];
    });
}

function staticTitle(markup: string): string {
    return markup
        .replace(/<FeatureHelpButton[\s\S]*?\/>/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\{[^{}]*\}/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function missingFeatureHelp(path: string): string[] {
    const source = readFileSync(path, 'utf8');
    const headings = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/g;
    const missing: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = headings.exec(source))) {
        const label = staticTitle(match[2]);
        if (label.length < 3 || !/[\p{L}\p{N}]/u.test(label) || NON_FUNCTIONAL_TITLE.test(label)) continue;

        const nextHeading = source.indexOf('<h', headings.lastIndex);
        const nearbyEnd =
            nextHeading === -1 ? headings.lastIndex + 320 : Math.min(nextHeading, headings.lastIndex + 320);
        const nearby = `${match[0]}${source.slice(headings.lastIndex, nearbyEnd)}`;
        if (!nearby.includes('<FeatureHelpButton')) missing.push(label);
    }

    return missing;
}

describe('feature help coverage', () => {
    it('keeps every static functional framework title connected to a help button', () => {
        const missing = tsxFiles(SOURCE_ROOT)
            .filter(path => !EXCLUDED_PATHS.includes(relative(SOURCE_ROOT, path)))
            .flatMap(path =>
                missingFeatureHelp(path).map(title => `${relative(SOURCE_ROOT, path)}: ${title}`),
            );

        expect(missing).toEqual([]);
    });
});
