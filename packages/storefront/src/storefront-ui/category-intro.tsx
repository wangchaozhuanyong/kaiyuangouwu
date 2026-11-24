import { parseCollectionDescription } from '../../../storefront-content-plugin/src/shared/collection-faq';
import { ContentText } from '../../../storefront-content-plugin/src/shared/content-text';
import { sanitizeProductDescription } from '../rich-text';
import { type StorefrontLanguage } from '../types';

import '../styles/category-intro.css';

/**
 * Merchant-owned category overview. Same component for every store and both layouts;
 * the text only comes from the published collection description, never from a store name.
 * A trailing `## 常见问题` section becomes a real FAQ list that matches the page's structured data.
 */
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
    const isZh = language === 'zh';
    return (
        <section className="category-intro" aria-label={isZh ? '分类说明' : 'Category overview'}>
            {html.trim() ? <ContentText html={html} /> : null}
            {faq.length > 0 && (
                <div className="category-faq">
                    <h2>{isZh ? '常见问题' : 'FAQ'}</h2>
                    <dl>
                        {faq.map(item => (
                            <div className="category-faq-item" key={item.question}>
                                <dt>{item.question}</dt>
                                <dd>{item.answer}</dd>
                            </div>
                        ))}
                    </dl>
                </div>
            )}
        </section>
    );
}
