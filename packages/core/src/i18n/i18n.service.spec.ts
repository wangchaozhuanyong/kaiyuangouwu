import i18next from 'i18next';
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { detectVendureRequestLanguage, I18nService } from './i18n.service';

function flattenMessages(value: unknown, prefix = ''): Map<string, string> {
    const result = new Map<string, string>();
    if (typeof value === 'string') {
        result.set(prefix, value);
        return result;
    }
    if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            const childPrefix = prefix ? `${prefix}.${key}` : key;
            for (const [childKey, message] of flattenMessages(child, childPrefix)) {
                result.set(childKey, message);
            }
        }
    }
    return result;
}

function getArgumentNames(message: string): string[] {
    const names = new Set<string>();
    let depth = 0;
    for (let index = 0; index < message.length; index++) {
        if (message[index] === '{') {
            if (depth === 0) {
                const argument = message.slice(index + 1).match(/^\s*([A-Za-z_][\w.]*)\s*[,}]/u);
                if (argument) {
                    names.add(argument[1]);
                }
            }
            depth++;
        } else if (message[index] === '}') {
            depth--;
        }
    }
    return [...names].sort();
}

// https://github.com/vendurehq/vendure/issues/4823
describe('I18nService', () => {
    let i18nService: I18nService;

    beforeAll(async () => {
        i18nService = new I18nService({} as any);
        await i18nService.onModuleInit();
    });

    it('sets supportedLngs to the bundled languages', () => {
        const supportedLngs = i18next.options.supportedLngs as string[];
        for (const code of ['en', 'de', 'es', 'fr', 'pt_BR', 'pt_PT', 'ru', 'uk', 'zh_Hans']) {
            expect(supportedLngs).toContain(code);
        }
    });

    it('prefers display language over content language for translated API messages', () => {
        expect(
            detectVendureRequestLanguage({
                query: { languageCode: 'en', displayLanguageCode: 'zh_Hans' },
            } as any),
        ).toBe('zh_Hans');
    });

    it('falls back to content language when display language is absent or invalid', () => {
        expect(detectVendureRequestLanguage({ query: { languageCode: 'zh_Hans' } } as any)).toBe('zh_Hans');
        expect(
            detectVendureRequestLanguage({
                query: { languageCode: 'en', displayLanguageCode: '../zh_Hans' },
            } as any),
        ).toBe('en');
    });

    it('keeps the English and Simplified Chinese server catalogs in sync', () => {
        const messagesDir = path.join(__dirname, 'messages');
        const english = flattenMessages(
            JSON.parse(fs.readFileSync(path.join(messagesDir, 'en.json'), 'utf8')),
        );
        const simplifiedChinese = flattenMessages(
            JSON.parse(fs.readFileSync(path.join(messagesDir, 'zh_Hans.json'), 'utf8')),
        );

        expect([...simplifiedChinese.keys()].sort()).toEqual([...english.keys()].sort());
        for (const [key, englishMessage] of english) {
            const chineseMessage = simplifiedChinese.get(key);
            expect(chineseMessage, `${key} must have a Simplified Chinese translation`).toBeTruthy();
            expect(getArgumentNames(chineseMessage ?? ''), `${key} must preserve ICU arguments`).toEqual(
                getArgumentNames(englishMessage),
            );
        }
    });

    it('localizes built-in state names inside Simplified Chinese errors', () => {
        const message = i18next.getFixedT('zh_Hans')('errorResult.ORDER_STATE_TRANSITION_ERROR', {
            fromState: 'ArrangingPayment',
            toState: 'PaymentAuthorized',
        });

        expect(message).toBe('无法将订单从“安排付款”转换为“付款已授权”');
        expect(message).not.toMatch(/ArrangingPayment|PaymentAuthorized/u);
    });

    it('does not grow options.preload for unsupported language codes', async () => {
        const before = [...(i18next.options.preload as string[])];

        for (let i = 0; i < 50; i++) {
            await i18next.loadLanguages(`xx-${i}`);
        }
        await i18next.loadLanguages('zh-Hant-TW');

        expect(i18next.options.preload).toEqual(before);
    });

    it('resolves the exact underscore region code to its own bundle (pt_BR)', () => {
        // Vendure's LanguageCode enum uses underscores (e.g. `pt_BR`). Setting supportedLngs
        // must not collapse or reject these region-specific bundles.
        const match = i18next.services.languageUtils.getBestMatchFromCodes(['pt_BR']);
        expect(match).toBe('pt_BR');
    });

    it('falls back to en for a hyphenated region code with no matching bundle (pt-BR)', () => {
        // Browsers send `pt-BR` (hyphen) via Accept-Language, but we only ship `pt_BR`
        // (underscore). This resolves to the fallback — the same English result as before
        // the fix (which attempted a non-existent `pt-BR.json` load and then fell back),
        // so there is no regression.
        const match = i18next.services.languageUtils.getBestMatchFromCodes(['pt-BR']);
        expect(match).toBe('en');
    });

    it('addTranslation updates both the public and the cached supportedLngs', () => {
        // `zz` has no bundled message file, so it is only supported once registered.
        expect(i18next.options.supportedLngs).not.toContain('zz');

        i18nService.addTranslation('zz', { errorResult: {} });

        expect(i18next.options.supportedLngs).toContain('zz');
        // The cached copy read by isSupportedCode() must also be updated, otherwise the
        // language would be silently rejected by loadLanguages.
        expect((i18next as any).services.languageUtils.supportedLngs).toContain('zz');
    });

    it('loads a language into preload only after it has been registered', async () => {
        // Before registration: rejected by the supportedLngs filter, preload unchanged.
        const beforeRegistration = [...(i18next.options.preload as string[])];
        await i18next.loadLanguages('yy');
        expect(i18next.options.preload).toEqual(beforeRegistration);

        // After registration: accepted and appended to preload.
        i18nService.addTranslation('yy', { errorResult: {} });
        await i18next.loadLanguages('yy');
        expect(i18next.options.preload).toContain('yy');
    });
});
