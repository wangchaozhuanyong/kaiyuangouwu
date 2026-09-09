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
    /\{\{\s*(legalEntityName|legalRegistrationCountry|supportEmail|privacyEmail)\s*\}\}/gu;
const knownStorefrontHostnames = ['damatong.net', 'moyaoai.com'] as const;

export function legalScopeHostname(storefrontName: string, browserHostname?: string): string {
    const activeHost = normalizeHostname(browserHostname);
    if (knownStorefrontHostnames.includes(activeHost as (typeof knownStorefrontHostnames)[number])) {
        return activeHost;
    }
    const normalizedName = storefrontName.trim().toLowerCase();
    if (normalizedName.includes('moyao')) return 'moyaoai.com';
    if (normalizedName.includes('damatong') || normalizedName.includes('大马通')) return 'damatong.net';
    return activeHost;
}

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

    const document = {
        title: matchedItem?.label.trim() || matchedBlock.title.trim() || fallbackTitle,
        subtitle: matchedBlock.subtitle.trim(),
        body,
    };
    return referencesAnotherStorefront(document, activeHostname) ? null : document;
}

export function resolveManagedLegalIdentity(
    identity: StorefrontLegalIdentity | undefined,
    activeHostname?: string,
): StorefrontLegalIdentity | undefined {
    if (!identity) return undefined;
    return referencesAnotherStorefront(identity, activeHostname) ? undefined : identity;
}

function referencesAnotherStorefront(
    content: ManagedLegalDocument | StorefrontLegalIdentity,
    activeHostname: string | undefined,
): boolean {
    const activeHost = normalizeHostname(activeHostname);
    if (!knownStorefrontHostnames.includes(activeHost as (typeof knownStorefrontHostnames)[number])) {
        return false;
    }
    const searchableContent = Object.values(content).join('\n').toLowerCase();
    return knownStorefrontHostnames.some(
        hostname => hostname !== activeHost && searchableContent.includes(hostname),
    );
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
