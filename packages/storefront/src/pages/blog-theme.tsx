import {
    type BlogCategory,
    type BlogPublishedArticle,
} from '../../../storefront-content-plugin/src/shared/news-blog';
import categoryArt from '../assets/icons/blog-category-art.svg?raw';
import { type StorefrontLanguage } from '../types';

import { blogLabels } from './blog-labels';

const captions = {
    chatgpt: ['产品更新与使用指南', '#153f32'],
    claude: ['模型能力与使用方法', '#603322'],
    gemini: ['多模态与创作指南', '#f7f6ff'],
    industry: ['AI 产业与市场观察', '#253f50'],
    skills: ['发现实用技能与工作方法', '#30345f'],
} as const satisfies Record<BlogCategory, readonly [string, string]>;

const englishCaptions: Record<BlogCategory, string> = {
    chatgpt: 'Updates and guides',
    claude: 'Models and features',
    gemini: 'Multimodal guides',
    industry: 'AI industry news',
    skills: 'Skills and workflows',
};
const englishArt = categoryArt.replace('>行业动态<', '>Industry<').replace('>热门 Skill<', '>Skills<');

/** Only the bundled, static SVG is inlined here. Article copy is rendered by React below. */
export function BlogThemeLibrary({ language = 'zh' }: { language?: StorefrontLanguage }) {
    return (
        <div
            className="blog-theme-library"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: language === 'zh' ? categoryArt : englishArt }}
        />
    );
}

function themeCaption(article: BlogPublishedArticle, language: StorefrontLanguage) {
    const profile = article.skillProfile;
    if (article.category !== 'skills' || !profile)
        return language === 'zh' ? captions[article.category][0] : englishCaptions[article.category];
    const domain = blogLabels[language].domains[profile.domain];
    const task = article.tags.find(
        tag => tag !== domain && tag !== article.skill?.name && !profile.industries.includes(tag),
    );
    return task ? `${domain} · ${task}` : domain;
}

/** Keep print proportions on wide detail banners as well as narrow list cards. */
export function BlogTheme({
    article,
    language,
    featured = false,
}: {
    article: BlogPublishedArticle;
    language: StorefrontLanguage;
    featured?: boolean;
}) {
    const { category } = article;
    const caption = themeCaption(article, language);
    const characters = Array.from(caption);
    const captionLimit = language === 'zh' ? 14 : 29;
    if (featured) {
        return (
            <div
                className="blog-theme"
                data-category={category}
                data-layout="feature"
                aria-hidden="true"
                style={{ color: captions[category][1] }}
            >
                <svg className="blog-feature-paper" focusable="false">
                    <rect width="100%" height="100%" fill={`url(#blog-paper-${category})`} />
                </svg>
                <strong className="blog-feature-cover-title type-section">
                    {blogLabels[language].categories[category]}
                </strong>
                <svg
                    className="blog-feature-art"
                    viewBox={category === 'skills' ? '230 0 160 132' : '200 0 200 132'}
                    preserveAspectRatio="xMidYMid meet"
                    focusable="false"
                >
                    <use href={`#blog-art-${category}`} />
                </svg>
                <p className="blog-feature-caption type-helper">{caption}</p>
            </div>
        );
    }
    return (
        <div className="blog-theme" data-category={category} aria-hidden="true">
            <svg focusable="false">
                <rect width="100%" height="100%" fill={`url(#blog-paper-${category})`} />
                <svg width="50%" height="100%" viewBox="0 0 200 132" preserveAspectRatio="xMinYMid meet">
                    <use href={`#blog-masthead-${category}`} />
                    <text className="type-meta" x="20" y="109" fill={captions[category][1]}>
                        {characters.length > captionLimit
                            ? characters.slice(0, captionLimit - 1).join('') + '…'
                            : caption}
                    </text>
                </svg>
                <svg
                    x="50%"
                    width="50%"
                    height="100%"
                    viewBox="200 0 200 132"
                    preserveAspectRatio="xMaxYMid meet"
                >
                    <use href={`#blog-art-${category}`} />
                </svg>
            </svg>
        </div>
    );
}
