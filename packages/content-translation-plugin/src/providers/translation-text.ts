import { TranslationProviderError } from '../translation-provider-error.js';

interface ProtectedText {
    text: string;
    restore: (translated: string) => string;
}

const protectedPattern = /https?:\/\/[^\s<]+|\{\{[^{}]+\}\}|\{[^{}]+\}|%[A-Z0-9_]+%/giu;

export function protectText(value: string, glossary: Record<string, string>): ProtectedText {
    const replacements: Array<{ token: string; value: string }> = [];
    let sequence = 0;
    const reserve = (original: string, translated = original) => {
        const token = `ZXQTERM${String(sequence++).padStart(4, '0')}QXZ`;
        replacements.push({ token, value: translated });
        return token;
    };
    let text = value.replace(protectedPattern, match => reserve(match));
    for (const [source, target] of Object.entries(glossary).sort(
        ([left], [right]) => right.length - left.length,
    )) {
        if (!source) continue;
        text = text.split(source).join(reserve(source, target));
    }
    return {
        text,
        restore: translated => {
            let restored = translated;
            for (const replacement of replacements) {
                const tokenPattern = new RegExp([...replacement.token].map(escapeRegExp).join('\\s*'), 'giu');
                restored = restored.replace(tokenPattern, replacement.value);
            }
            if (/ZXQ\s*TERM/iu.test(restored)) {
                throw new TranslationProviderError('INVALID_RESPONSE');
            }
            return restored;
        },
    };
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function decodeHtmlEntities(value: string): string {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}
