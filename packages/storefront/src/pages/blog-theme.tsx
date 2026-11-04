import {
    skillDomains,
    type BlogCategory,
    type BlogPublishedArticle,
} from '../../../storefront-content-plugin/src/shared/news-blog';
import categoryArt from '../assets/icons/blog-category-art.svg?raw';

const captions = {
    chatgpt: ['产品更新与使用指南', '#153f32'],
    claude: ['模型能力与使用方法', '#603322'],
    gemini: ['多模态与创作指南', '#f7f6ff'],
    industry: ['AI 产业与市场观察', '#253f50'],
    skills: ['发现实用技能与工作方法', '#30345f'],
} as const satisfies Record<BlogCategory, readonly [string, string]>;

/** Only the bundled, static SVG is inlined here. Article copy is rendered by React below. */
export function BlogThemeLibrary() {
    return (
        <div
            className="blog-theme-library"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: categoryArt }}
        />
    );
}

function themeCaption(article: BlogPublishedArticle) {
    const profile = article.skillProfile;
    if (article.category !== 'skills' || !profile) return captions[article.category][0];
    const domain = skillDomains[profile.domain];
    const task = article.tags.find(
        tag => tag !== domain && tag !== article.skill?.name && !profile.industries.includes(tag),
    );
    return task ? `${domain} · ${task}` : domain;
}

/** Keep print proportions on wide detail banners as well as narrow list cards. */
export function BlogTheme({ article }: { article: BlogPublishedArticle }) {
    const { category } = article;
    const caption = themeCaption(article);
    const characters = Array.from(caption);
    return (
        <div className="blog-theme" data-category={category} aria-hidden="true">
            <svg focusable="false">
                <rect width="100%" height="100%" fill={`url(#blog-paper-${category})`} />
                <svg width="50%" height="100%" viewBox="0 0 200 132" preserveAspectRatio="xMinYMid meet">
                    <use href={`#blog-masthead-${category}`} />
                    <text className="type-meta" x="20" y="109" fill={captions[category][1]}>
                        {characters.length > 14 ? characters.slice(0, 13).join('') + '…' : caption}
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
