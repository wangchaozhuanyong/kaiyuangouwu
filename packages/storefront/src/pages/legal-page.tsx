import { CircleAlert } from 'lucide-react';

import { interpolateLegalProfileTokens, resolveManagedLegalDocument } from '../legal-content';
import { SubHeader } from '../storefront-ui/page-shell';
import { StorefrontContentBlock, StorefrontLanguage, StorefrontLegalIdentity } from '../types';

export interface ManagedLegalPageProps {
    kind: 'privacy' | 'terms';
    language: StorefrontLanguage;
    storefrontName: string;
    contentBlocks: StorefrontContentBlock[];
    legalIdentity?: StorefrontLegalIdentity;
    onBack: () => void;
}

export function ManagedLegalPage({
    kind,
    language,
    storefrontName,
    contentBlocks,
    legalIdentity,
    onBack,
}: ManagedLegalPageProps) {
    const isZh = language === 'zh';
    const isPrivacy = kind === 'privacy';
    const fallbackTitle = isPrivacy
        ? isZh
            ? '隐私政策'
            : 'Privacy Policy'
        : isZh
          ? '使用条款'
          : 'Terms of use';
    const document = resolveManagedLegalDocument(contentBlocks, kind, fallbackTitle);
    const title = interpolateLegalProfileTokens(document?.title ?? fallbackTitle, legalIdentity, language);
    const legalDetails = [
        {
            label: isZh ? '法定经营主体' : 'Legal entity',
            value: legalIdentity?.legalEntityName,
            isEmail: false,
        },
        {
            label: isZh ? '注册国家/地区' : 'Registration country/region',
            value: legalIdentity?.legalRegistrationCountry,
            isEmail: false,
        },
        {
            label: isZh ? '客服邮箱' : 'Support email',
            value: legalIdentity?.supportEmail,
            isEmail: true,
        },
        {
            label: isZh ? '隐私邮箱' : 'Privacy email',
            value: legalIdentity?.privacyEmail,
            isEmail: true,
        },
    ].filter((detail): detail is { label: string; value: string; isEmail: boolean } =>
        Boolean(detail.value?.trim()),
    );

    return (
        <main className="page subpage legal-page">
            <SubHeader title={title} language={language} onBack={onBack} />
            <article className="legal-managed-content">
                {document?.subtitle && (
                    <header className="legal-managed-intro">
                        <p>{interpolateLegalProfileTokens(document.subtitle, legalIdentity, language)}</p>
                    </header>
                )}
                {legalDetails.length > 0 ? (
                    <dl
                        className="legal-identity-card"
                        aria-label={isZh ? '经营主体与联系信息' : 'Legal identity and contact information'}
                    >
                        {legalDetails.map(({ label, value, isEmail }) => (
                            <div key={label}>
                                <dt>{label}</dt>
                                <dd>
                                    {isEmail && isValidEmail(value) ? (
                                        <a href={`mailto:${value}`}>{value}</a>
                                    ) : (
                                        value
                                    )}
                                </dd>
                            </div>
                        ))}
                    </dl>
                ) : null}
                {document ? (
                    <div className="legal-managed-body">
                        {interpolateLegalProfileTokens(document.body, legalIdentity, language)}
                    </div>
                ) : (
                    <div className="legal-managed-empty" role="status">
                        <CircleAlert aria-hidden="true" />
                        <div>
                            <strong>{isZh ? '法律文件暂未发布' : 'Legal document not published'}</strong>
                            <p>
                                {isZh
                                    ? '请联系店铺客服获取最新政策内容。'
                                    : 'Contact store support for the current policy.'}
                            </p>
                        </div>
                    </div>
                )}
                <footer>
                    <strong>{storefrontName}</strong>
                    <span>{title}</span>
                </footer>
            </article>
        </main>
    );
}

function isValidEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}
