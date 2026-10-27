import { StorefrontLanguage, StorefrontLegalIdentity } from './types';

export { resolveManagedLegalDocument } from '../../storefront-content-plugin/src/shared/legal-content';
export type {
    LegalDocumentKind,
    ManagedLegalDocument,
} from '../../storefront-content-plugin/src/shared/legal-content';

const legalProfileTokenPattern =
    /\{\{\s*(legalEntityName|legalRegistrationCountry|legalRegistrationNumber|legalContactAddress|supportEmail|privacyEmail)\s*\}\}/gu;
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
