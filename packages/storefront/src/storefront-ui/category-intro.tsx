import { ChevronDown } from 'lucide-react';

import { parseCollectionDescription } from '../../../storefront-content-plugin/src/shared/collection-faq';
import { ContentText } from '../../../storefront-content-plugin/src/shared/content-text';
import { sanitizeProductDescription } from '../rich-text';
import { type StorefrontLanguage } from '../types';

import '../styles/category-intro.css';

export function CategoryIntro({
    description,
    language,
}: {
    description: string | null | undefined;
    language: StorefrontLanguage;
}) {
    const { intro, faq } = parseCollectionDescription(description);
    const html = sanitizeProductDescription(intro, { textOnly: true });
    if (!html.trim() && !faq.length) return null;

    const title = language === 'zh' ? '分类说明' : 'Category overview';
    return (
        <section className="category-intro" aria-label={title}>
            {html.trim() && (
                <div className="category-intro-copy">
                    <h2 className="type-section">{title}</h2>
                    <ContentText html={html} />
                </div>
            )}
            {faq.length > 0 && (
                <div className="category-faq">
                    <h2 className="type-section">{language === 'zh' ? '常见问题' : 'FAQ'}</h2>
                    {faq.map(item => (
                        <details key={item.question}>
                            <summary className="type-label">
                                {item.question}
                                <ChevronDown size={16} aria-hidden="true" />
                            </summary>
                            <p className="type-body">{item.answer}</p>
                        </details>
                    ))}
                </div>
            )}
        </section>
    );
}
