import {
    blogCategoryLabels,
    skillDomains,
    type BlogPublishedArticle,
} from '../../../storefront-content-plugin/src/shared/news-blog';

/** Deterministic artwork shared by the HTML response and the hydrated page. No media requests. */
export function BlogTheme({ article }: { article: BlogPublishedArticle }) {
    const themes = {
        chatgpt: {
            path: 'M6 4h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-6 4V7a3 3 0 0 1 3-3Z M7 9h10 M7 13h7',
            tone: 'mail',
            label: '产品更新与使用指南',
        },
        claude: {
            path: 'M12 2v20 M2 12h20 M5 5l14 14 M5 19 19 5 M8 3l8 18 M3 8l18 8 M3 16l18-8 M8 21 16 3',
            tone: 'coupon',
            label: '模型能力与实用方法',
        },
        gemini: {
            path: 'M12 2C12 8 8 12 2 12c6 0 10 4 10 10 0-6 4-10 10-10-6 0-10-4-10-10Z',
            tone: 'studio',
            label: '多模态与创作灵感',
        },
        industry: {
            path: 'M9 2h6v6H9Z M2 16h6v6H2Z M16 16h6v6h-6Z M12 8v4 M5 16v-4h14v4',
            tone: 'security',
            label: 'AI 行业观察',
        },
        skills: {
            path: 'M2 3h8v8H2Z M14 3h8v8h-8Z M2 15h8v8H2Z M18 14v10 M13 19h10',
            tone: 'security',
            label: '发现能派上用场的技能',
        },
    } as const;
    const theme = themes[article.category];
    return (
        <div
            className="blog-theme"
            data-category={article.category}
            data-icon-tone={theme.tone}
            aria-hidden="true"
        >
            <div className="blog-theme-copy">
                <strong className="type-page">{blogCategoryLabels[article.category]}</strong>
                <span className="type-helper">
                    {article.skillProfile ? skillDomains[article.skillProfile.domain] : theme.label}
                </span>
            </div>
            <div className="blog-theme-symbol">
                <svg
                    viewBox="0 0 24 26"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d={theme.path} />
                </svg>
            </div>
        </div>
    );
}
