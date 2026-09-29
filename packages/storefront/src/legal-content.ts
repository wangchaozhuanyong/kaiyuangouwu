import {
    StorefrontContentBlock,
    StorefrontContentItem,
    StorefrontLanguage,
    StorefrontLegalIdentity,
} from './types';

export type LegalDocumentKind = 'privacy' | 'terms';

export interface ManagedLegalDocument {
    title: string;
    subtitle: string;
    body: string;
}

const legalProfileTokenPattern =
    /\{\{\s*(legalEntityName|legalRegistrationCountry|legalRegistrationNumber|legalContactAddress|supportEmail|privacyEmail)\s*\}\}/gu;
const declaredScopePattern =
    /(?:适用于|applies?\s+to)[\s\S]{0,100}?(?:https?:\/\/)?((?:www\.)?[a-z\d-]+(?:\.[a-z\d-]+)+)/iu;

export function interpolateLegalProfileTokens(
    value: string,
    identity: StorefrontLegalIdentity | undefined,
    language: StorefrontLanguage,
): string {
    const missingValue = language === 'zh' ? '待配置' : 'Not configured';
    return value.replace(legalProfileTokenPattern, (_match, key: keyof StorefrontLegalIdentity) => {
        const replacement = identity?.[key]?.trim();
        return replacement || missingValue;
    });
}

export function resolveManagedLegalDocument(
    blocks: StorefrontContentBlock[],
    kind: LegalDocumentKind,
    fallbackTitle: string,
    activeHostname?: string,
): ManagedLegalDocument | null {
    const legalBlocks = blocks.filter(block => block.type === 'LEGAL');
    const matchedBlock =
        legalBlocks.find(block => blockCodeMatches(block.code, kind)) ??
        legalBlocks.find(block => block.items.some(item => itemMatchesKind(item, kind)));
    if (!matchedBlock) return null;

    const matchedItem = matchedBlock.items.find(item => itemMatchesKind(item, kind));
    const body = matchedItem?.description.trim() || matchedBlock.body.trim();
    if (!body) return null;
    const activeHost = normalizeHostname(activeHostname);
    const declaredHost = normalizeHostname(body.slice(0, 1_500).match(declaredScopePattern)?.[1]);
    if (activeHost && declaredHost && activeHost !== declaredHost) return null;

    return {
        title: matchedItem?.label.trim() || matchedBlock.title.trim() || fallbackTitle,
        subtitle: matchedBlock.subtitle.trim(),
        body,
    };
}

function normalizeHostname(value: string | undefined): string {
    return (value ?? '')
        .trim()
        .toLowerCase()
        .replace(/^www\./u, '')
        .replace(/\.$/u, '');
}

function blockCodeMatches(code: string, kind: LegalDocumentKind): boolean {
    const normalized = code.trim().toLowerCase();
    return kind === 'privacy'
        ? normalized === 'privacy' || normalized === 'privacy-policy'
        : normalized === 'terms' || normalized === 'terms-of-use';
}

function itemMatchesKind(item: StorefrontContentItem, kind: LegalDocumentKind): boolean {
    if (item.targetType !== 'PAGE' || !item.targetValue) return false;
    const normalized = item.targetValue.trim().toLowerCase().replace(/^#?\//u, '');
    return normalized === `legal?id=${kind}` || normalized === kind;
}
