import { StorefrontContentBlock, StorefrontContentItem } from './types';

export type LegalDocumentKind = 'privacy' | 'terms';

export interface ManagedLegalDocument {
    title: string;
    subtitle: string;
    body: string;
}

export function resolveManagedLegalDocument(
    blocks: StorefrontContentBlock[],
    kind: LegalDocumentKind,
    fallbackTitle: string,
): ManagedLegalDocument | null {
    const legalBlocks = blocks.filter(block => block.type === 'LEGAL');
    const matchedBlock =
        legalBlocks.find(block => blockCodeMatches(block.code, kind)) ??
        legalBlocks.find(block => block.items.some(item => itemMatchesKind(item, kind)));
    if (!matchedBlock) return null;

    const matchedItem = matchedBlock.items.find(item => itemMatchesKind(item, kind));
    const body = matchedItem?.description.trim() || matchedBlock.body.trim();
    if (!body) return null;

    return {
        title: matchedItem?.label.trim() || matchedBlock.title.trim() || fallbackTitle,
        subtitle: matchedBlock.subtitle.trim(),
        body,
    };
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
