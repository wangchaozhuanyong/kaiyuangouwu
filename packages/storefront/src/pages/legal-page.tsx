import { CircleAlert } from 'lucide-react';

import { resolveManagedLegalDocument } from '../legal-content';
import { SubHeader } from '../storefront-ui/page-shell';
import { StorefrontContentBlock, StorefrontLanguage } from '../types';

export interface ManagedLegalPageProps {
    kind: 'privacy' | 'terms';
    language: StorefrontLanguage;
    storefrontName: string;
    contentBlocks: StorefrontContentBlock[];
    onBack: () => void;
}

export function ManagedLegalPage({
    kind,
    language,
    storefrontName,
    contentBlocks,
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
    const title = document?.title ?? fallbackTitle;

    return (
        <main className="page subpage legal-page">
            <SubHeader title={title} language={language} onBack={onBack} />
            <article className="legal-managed-content">
                {document?.subtitle && (
                    <header className="legal-managed-intro">
                        <p>{document.subtitle}</p>
                    </header>
                )}
                {document ? (
                    <div className="legal-managed-body">{document.body}</div>
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
