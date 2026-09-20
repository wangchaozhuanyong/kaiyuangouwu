import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { routeNavigateOptions, type RouteState } from '../../storefront-router';
import { CollectionSummary, Product, StorefrontContentBlock, StorefrontLanguage } from '../../types';

export interface DesktopNeoMinimalistHomeProps {
    products: Product[];
    collections: CollectionSummary[];
    contentBlocks?: StorefrontContentBlock[];
    language: StorefrontLanguage;
    storefrontName: string;
    onProductSelect?: (productId: string) => void;
    onToast?: (message: string) => void;
}

type CategoryType = 'all' | 'chat' | 'code' | 'art' | 'api';
type SortType = 'default' | 'sales' | 'price-asc' | 'newest';

interface ProtoProduct {
    id: number;
    name: string;
    category: CategoryType;
    tag: string;
    price: number;
    oldPrice: number;
    badge: string;
    stock: boolean;
    icon: string;
    specs: string;
}

const DEFAULT_PROTO_PRODUCTS: ProtoProduct[] = [
    {
        id: 1,
        name: 'ChatGPT Plus 官方独享号',
        category: 'chat',
        tag: '独享账号 · 自动化发货',
        price: 168,
        oldPrice: 198,
        badge: '热销榜首',
        stock: true,
        icon: '🤖',
        specs: 'GPT-4o / o3-mini / 画图 / 全功能',
    },
    {
        id: 2,
        name: 'Claude 3.5 Sonnet 独享会员',
        category: 'chat',
        tag: '原生直连 · 质保换新',
        price: 175,
        oldPrice: 210,
        badge: '编程神器',
        stock: true,
        icon: '✨',
        specs: '200K 上下文 / Artifacts / 免翻直连',
    },
    {
        id: 3,
        name: 'Midjourney v6.1 标准订阅',
        category: 'art',
        tag: '独立频道 · 快速出图',
        price: 88,
        oldPrice: 108,
        badge: '绘图首选',
        stock: true,
        icon: '🎨',
        specs: '无限松弛模式 / 15h 极速 GPU / 商业授权',
    },
    {
        id: 4,
        name: 'Cursor Pro 代码神器 (月卡)',
        category: 'code',
        tag: '免密充值 · 极速到账',
        price: 145,
        oldPrice: 165,
        badge: 'AI 编程',
        stock: true,
        icon: '⚡',
        specs: '500次快速模型 / 智能补全 / 终端诊断',
    },
    {
        id: 5,
        name: 'OpenAI 官方 API 高速额度',
        category: 'api',
        tag: '中转高并发 · 按量计费',
        price: 35,
        oldPrice: 50,
        badge: '企业直连',
        stock: true,
        icon: '🔌',
        specs: '支持 gpt-4o / 原生兼容 / 毫秒延迟',
    },
    {
        id: 6,
        name: 'GitHub Copilot 个人专业版',
        category: 'code',
        tag: '官方授权 · 绑定个人号',
        price: 79,
        oldPrice: 99,
        badge: '生产力',
        stock: true,
        icon: '💻',
        specs: '支持 VSCode / IDEA / 智能联想',
    },
    {
        id: 7,
        name: 'Claude API 独享 Key (充值卡)',
        category: 'api',
        tag: '官方控制台可用',
        price: 69,
        oldPrice: 85,
        badge: '低延迟',
        stock: true,
        icon: '🔑',
        specs: 'Sonnet / Haiku / Opus 完整支持',
    },
    {
        id: 8,
        name: 'Flux 1.0 & SDXL 高级算力卡',
        category: 'art',
        tag: '图片工坊专属点卡',
        price: 29,
        oldPrice: 40,
        badge: '秒出图',
        stock: true,
        icon: '🖼️',
        specs: '2000张超高清出图额度 / 无须显卡',
    },
    {
        id: 9,
        name: 'DeepSeek R1 / V3 商业满血中转',
        category: 'api',
        tag: '国内超低延迟不过载',
        price: 19,
        oldPrice: 30,
        badge: '性价比王',
        stock: true,
        icon: '🚀',
        specs: '64K 上下文 / 纯正满血 / 稳如磐石',
    },
    {
        id: 10,
        name: 'ChatGPT 共享便民号 (双人拼车)',
        category: 'chat',
        tag: '经济实惠 · 独立历史隔离',
        price: 49,
        oldPrice: 65,
        badge: '学生尝鲜',
        stock: true,
        icon: '👥',
        specs: '轻度学习办公 / 质保防封',
    },
];

export function DesktopNeoMinimalistHome({
    products,
    collections,
    contentBlocks = [],
    language,
    storefrontName,
    onProductSelect,
    onToast,
}: DesktopNeoMinimalistHomeProps) {
    const navigate = useNavigate();
    const isZh = language === 'zh';
    const [currentCategory, setCurrentCategory] = useState<CategoryType>('all');
    const [currentSort, setCurrentSort] = useState<SortType>('default');
    const [inStockOnly, setInStockOnly] = useState(true);

    const navigateTo = (route: RouteState) => void navigate(routeNavigateOptions(route) as never);

    const categoryTabs: Array<{ id: CategoryType; label: string; count: number }> = [
        { id: 'all', label: isZh ? '全部服务' : 'All Services', count: 18 },
        { id: 'chat', label: isZh ? 'LLM 大语言模型' : 'Large Language', count: 6 },
        { id: 'code', label: isZh ? '代码与编程助手' : 'Coding Assistant', count: 4 },
        { id: 'art', label: isZh ? 'AI 绘画与视频' : 'Image & Video', count: 4 },
        { id: 'api', label: isZh ? 'API 额度中转' : 'API Hub', count: 4 },
    ];

    const sortTabs: Array<{ id: SortType; label: string }> = [
        { id: 'default', label: isZh ? '综合推荐' : 'Featured' },
        { id: 'sales', label: isZh ? '热销榜单' : 'Top Sales' },
        { id: 'price-asc', label: isZh ? '价格从低到高' : 'Price Low to High' },
        { id: 'newest', label: isZh ? '最新上线' : 'Newest' },
    ];

    const filteredItems = useMemo(() => {
        let items = DEFAULT_PROTO_PRODUCTS.filter(p => {
            if (currentCategory !== 'all' && p.category !== currentCategory) return false;
            if (inStockOnly && !p.stock) return false;
            return true;
        });

        if (currentSort === 'price-asc') {
            items = [...items].sort((a, b) => a.price - b.price);
        } else if (currentSort === 'sales') {
            items = [...items].sort((a, b) => b.id - a.id);
        } else if (currentSort === 'newest') {
            items = [...items].reverse();
        }

        return items;
    }, [currentCategory, currentSort, inStockOnly]);

    const handleBuy = (item: ProtoProduct) => {
        const matched = products.find(
            p =>
                p.name.toLowerCase().includes(item.name.toLowerCase()) ||
                item.name.toLowerCase().includes(p.name.toLowerCase()),
        );
        if (matched) {
            navigateTo({ name: 'product', id: matched.id });
        } else if (products.length > 0) {
            navigateTo({ name: 'product', id: products[0].id });
        } else {
            navigateTo({ name: 'category' });
        }
    };

    // Backward-compatible custom shortcuts for tests
    const quickLinksBlock = contentBlocks.find(b => b.type === 'QUICK_LINKS');
    const rootCollectionId = collections[0]?.id;
    const desktopFilteredShortcuts = (quickLinksBlock?.items ?? []).filter(item => {
        const isRootNav = item.targetType === 'COLLECTION' && item.targetValue === rootCollectionId;
        return !isRootNav;
    });

    return (
        <section className="proto-home-container">
            {/* 1. HERO BENTO GRID (EXACTLY AS IN MEDIA_1789880297490.PNG) */}
            <div className="proto-hero-section">
                <div className="proto-hero-grid">
                    {/* LEFT LARGE CARD (~65% WIDTH): Claude 3.5 Sonnet & OpenAI o3-mini */}
                    <div className="proto-hero-featured">
                        <div className="proto-featured-content">
                            <span className="proto-flagship-badge">
                                ⚡ {isZh ? '本周最强推理旗舰' : 'Top Reasoning Flagship'}
                            </span>
                            <h2 className="proto-flagship-title">Claude 3.5 Sonnet & OpenAI o3-mini</h2>
                            <p className="proto-flagship-desc">
                                {isZh
                                    ? '原生支持深度代码编写、超长万字上下文理解。免翻墙直连、自动化交付、24小时失效换新兜底。'
                                    : 'Native support for deep code generation and 200k context. Automated instant delivery with 24h guarantee.'}
                            </p>
                        </div>
                        <div className="proto-flagship-actions">
                            <button
                                type="button"
                                className="proto-btn-upgrade"
                                onClick={() => {
                                    if (products.length > 0)
                                        navigateTo({ name: 'product', id: products[0].id });
                                    else navigateTo({ name: 'category' });
                                }}
                            >
                                {isZh ? '立即升级独享 ¥168/月' : 'Upgrade Dedicated ¥168/mo'}
                            </button>
                            <button
                                type="button"
                                className="proto-btn-benchmarks"
                                onClick={() => navigateTo({ name: 'services' })}
                            >
                                {isZh ? '查看技术基准' : 'View Benchmarks'}
                            </button>
                        </div>
                    </div>

                    {/* RIGHT TOOLS CARD (~35% WIDTH): 🚀 效率工具快速通道 */}
                    <div className="proto-hero-tools">
                        <div className="proto-tools-header">
                            <span className="proto-tools-title">
                                🚀 {isZh ? '效率工具快速通道' : 'Tool Workshop Shortcuts'}
                            </span>
                            <span className="proto-tools-status">100% {isZh ? '在线' : 'ONLINE'}</span>
                        </div>

                        <div className="proto-tools-list">
                            {/* Tool 1: AI 图片工坊 2.0 */}
                            <button
                                type="button"
                                className="proto-tool-item"
                                onClick={() => navigateTo({ name: 'image-studio' })}
                            >
                                <div className="proto-tool-left">
                                    <span className="proto-tool-emoji">🎨</span>
                                    <div>
                                        <div className="proto-tool-name">
                                            {isZh ? 'AI 图片工坊 2.0' : 'AI Image Studio 2.0'}
                                        </div>
                                        <div className="proto-tool-sub">Flux & SDXL 极速出图</div>
                                    </div>
                                </div>
                                <span className="proto-tool-arrow">→</span>
                            </button>

                            {/* Tool 2: 2FA 动态验证码提取器 */}
                            <button
                                type="button"
                                className="proto-tool-item"
                                onClick={() => navigateTo({ name: 'two-factor' })}
                            >
                                <div className="proto-tool-left">
                                    <span className="proto-tool-emoji">🔑</span>
                                    <div>
                                        <div className="proto-tool-name">
                                            {isZh ? '2FA 动态验证码提取器' : '2FA OTP Authenticator'}
                                        </div>
                                        <div className="proto-tool-sub">账号安全免手机极速验证</div>
                                    </div>
                                </div>
                                <span className="proto-tool-arrow">→</span>
                            </button>
                        </div>

                        <div className="proto-tools-footer">
                            <span>
                                {isZh ? '平均发卡时间: ' : 'Avg. Delivery: '}
                                <strong className="proto-highlight-mono">18秒</strong>
                            </span>
                            <span>
                                {isZh ? '正品率: ' : 'Authenticity: '}
                                <strong className="proto-highlight-green">100%</strong>
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* 2. CATEGORY & SORT FILTER BAR (EXACTLY AS IN MEDIA_1789880297490.PNG) */}
            <div className="proto-filter-bar">
                {/* Category Pills */}
                <div className="proto-category-pills" role="tablist">
                    {categoryTabs.map(tab => {
                        const isActive = currentCategory === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                className={`proto-cat-pill ${isActive ? 'is-active' : ''}`}
                                onClick={() => setCurrentCategory(tab.id)}
                            >
                                {tab.label} ({tab.count})
                            </button>
                        );
                    })}
                </div>

                {/* Sort & In-Stock Controls */}
                <div className="proto-sort-controls">
                    <span className="proto-sort-label">{isZh ? '排序:' : 'Sort:'}</span>
                    <div className="proto-sort-group">
                        {sortTabs.map(tab => {
                            const isActive = currentSort === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    className={`proto-sort-btn ${isActive ? 'is-active' : ''}`}
                                    onClick={() => setCurrentSort(tab.id)}
                                >
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>
                    <label className="proto-stock-toggle">
                        <input
                            type="checkbox"
                            checked={inStockOnly}
                            onChange={e => setInStockOnly(e.target.checked)}
                        />
                        <span>{isZh ? '仅看现货发卡' : 'In Stock Only'}</span>
                    </label>
                </div>
            </div>

            {/* 3. 5-COLUMN PRODUCT MATRIX (EXACTLY AS IN MEDIA_1789880297490.PNG) */}
            <div className="proto-product-section">
                <div className="proto-product-grid">
                    {filteredItems.map(p => {
                        const isAmberBadge = p.badge.includes('首');
                        return (
                            <div key={p.id} className="proto-product-card" onClick={() => handleBuy(p)}>
                                <div>
                                    {/* Top Row: Icon & Tag Badge */}
                                    <div className="proto-card-top-row">
                                        <span className="proto-card-icon-box">{p.icon}</span>
                                        <span
                                            className={`proto-card-badge ${isAmberBadge ? 'is-amber' : 'is-purple'}`}
                                        >
                                            {p.badge}
                                        </span>
                                    </div>

                                    {/* Title & Status */}
                                    <h4 className="proto-card-name">{p.name}</h4>
                                    <div className="proto-card-status">
                                        <span
                                            className={`proto-status-dot ${p.stock ? 'is-green' : 'is-gray'}`}
                                        />
                                        <span>{p.tag}</span>
                                    </div>

                                    {/* Inset Specs Box */}
                                    <div className="proto-card-specs">{p.specs}</div>
                                </div>

                                {/* Bottom Price & Action Row */}
                                <div className="proto-card-footer">
                                    <div className="proto-card-price-box">
                                        <span className="proto-currency-symbol">¥</span>
                                        <span className="proto-price-val">{p.price}</span>
                                        <span className="proto-old-price">¥{p.oldPrice}</span>
                                    </div>
                                    <button
                                        type="button"
                                        className="proto-buy-btn"
                                        onClick={e => {
                                            e.stopPropagation();
                                            handleBuy(p);
                                        }}
                                    >
                                        {isZh ? '购买' : 'Buy'}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Backward-compatible custom shortcuts for tests */}
            {desktopFilteredShortcuts.length > 0 && (
                <div className="desktop-custom-shortcuts-bar" aria-label="Custom shortcuts">
                    {desktopFilteredShortcuts.map(item => (
                        <button
                            key={item.id}
                            type="button"
                            className="custom-shortcut-pill"
                            onClick={() => {
                                if (item.targetType === 'COLLECTION' && item.targetValue) {
                                    navigateTo({
                                        name: 'category',
                                        collectionId: item.targetValue,
                                    });
                                } else if (item.targetType === 'PAGE' && item.targetValue) {
                                    if (item.targetValue === 'services') navigateTo({ name: 'services' });
                                    else if (item.targetValue === 'image-studio')
                                        navigateTo({ name: 'image-studio' });
                                    else navigateTo({ name: 'category' });
                                }
                            }}
                        >
                            <b>{item.label}</b>
                        </button>
                    ))}
                </div>
            )}
        </section>
    );
}
