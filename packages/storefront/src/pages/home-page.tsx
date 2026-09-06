import { useNavigate } from '@tanstack/react-router';
import {
    Badge,
    Bell,
    Check,
    ChevronDown,
    ChevronRight,
    CircleCheck,
    Clock3,
    Download,
    ExternalLink,
    Flame,
    Headphones,
    LayoutGrid,
    Lock,
    Package,
    RotateCcw,
    ShieldCheck,
    ShoppingBag,
    Sparkles,
    Tag,
    Truck,
    Waypoints,
    WifiOff,
    Zap,
} from 'lucide-react';
import {
    ReactNode,
    PointerEvent as ReactPointerEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

import {
    normalizedHeroThemePreset,
    normalizedHomepageVisualStyle,
} from '../../../storefront-content-plugin/src/content-visuals';
import { ProductCard } from '../components/common/product-card';
import { claimableCouponCampaigns } from '../coupon-center-state';
import { heroIndexAfterManualMove, isCompletedHeroSwipe } from '../hero-carousel';
import { heroThemeStyle, heroUsesImageOverlay } from '../hero-theme';
import { selectCategoryPromotionProducts, selectManagedProducts } from '../home-merchandising';
import { desktopIntroModuleOrder, homepageModuleEntries } from '../homepage-module-order';
import { resolveManagedContentCopy } from '../managed-content-copy';
import { PageSkeleton } from '../route-loading';
import { couponCardsFromCampaigns, StorefrontCouponCard } from '../storefront-coupons';
import { HomePageContext } from '../storefront-page-contexts';
import { routeNavigateOptions, type RouteState } from '../storefront-router';
import {
    BrandLogo,
    dualCardTemplateSetting,
    localizedDualCardItemSetting,
    useFlashSaleCountdown,
} from '../storefront-ui/content-ui';
import {
    EmptyState,
    InlineError,
    LegalFooter,
    NoticeButton,
    SectionHeader,
    Sheet,
    Subpage,
} from '../storefront-ui/page-shell';
import {
    contentNumberSetting,
    contentStringArraySetting,
    decodeStorefrontImage,
    formatMoney,
    minimumProductPrice,
    productImage,
    renderColorfulQuickIcon,
    SafeImage,
    shouldPrefetchMedia,
    trimText,
} from '../storefront-ui/product-display';
import { ProductSection } from '../storefront-ui/product-section';
import {
    CollectionSummary,
    MarketConfig,
    Product,
    StorefrontContentBlock,
    StorefrontContentItem,
    StorefrontContentTargetType,
    StorefrontCouponCampaign,
    StorefrontFlashSale,
    StorefrontFlashSaleItem,
    StorefrontLanguage,
    StorefrontSystemAnnouncement,
} from '../types';

// TODO: Import other internal components like BrandLogo, ProductSection

interface HomepageCouponHubProps {
    block?: StorefrontContentBlock;
    coupons: StorefrontCouponCard[];
    language: StorefrontLanguage;
    loading: boolean;
    queryLoading: boolean;
    queryError: string;
    onClaim: (campaignId: string) => Promise<string | null>;
    onRetry: () => void;
    onToast?: (message: string) => void;
}

const homepageSectionShellClassName = 'homepage-module-shell is-section-start';
function isColorfulHomepageStyle(value: unknown) {
    return normalizedHomepageVisualStyle(value) === 'colorful';
}

export interface HomeNoticeItem {
    id: string;
    summary: string;
    title: string;
    content: string;
    ctaLabel: string;
    targetType: StorefrontContentTargetType;
    targetValue: string | null;
    linkUrl: string | null;
}

export function buildHomeNoticeItems(
    systemAnnouncements: StorefrontSystemAnnouncement[],
    noticeBlock: StorefrontContentBlock | undefined,
    language: StorefrontLanguage,
): HomeNoticeItem[] {
    const systemNoticeItems = systemAnnouncements.flatMap(announcement => {
        const announcementTitle = announcement.title.trim();
        const content = announcement.content.trim();
        if (!announcementTitle && !content) return [];
        return [
            {
                id: `system-${announcement.id}`,
                summary: [announcementTitle, content].filter(Boolean).join(' · '),
                title: announcementTitle,
                content,
                ctaLabel: '',
                targetType: 'NONE' as const,
                targetValue: null,
                linkUrl: announcement.linkUrl,
            },
        ];
    });
    const managedNoticeItems = (noticeBlock?.items ?? []).flatMap(item => {
        const label = item.label.trim();
        const description = item.description.trim();
        if (!label && !description) return [];
        return [
            {
                id: item.id,
                summary: label || description,
                title: label || noticeBlock?.title || (language === 'zh' ? '公告详情' : 'Notice details'),
                content: description,
                ctaLabel: '',
                targetType: item.targetType,
                targetValue: item.targetValue,
                linkUrl: null,
            },
        ];
    });
    if (managedNoticeItems.length || !noticeBlock || noticeBlock.items.length) {
        return [...systemNoticeItems, ...managedNoticeItems];
    }

    const title = noticeBlock.title.trim();
    const subtitle = noticeBlock.subtitle.trim();
    const body = noticeBlock.body.trim();
    if (!title && !subtitle && !body) return systemNoticeItems;
    if (systemNoticeItems.length && !subtitle && !body) return systemNoticeItems;
    return [
        ...systemNoticeItems,
        {
            id: noticeBlock.id,
            summary: title || body || subtitle,
            title,
            content: [subtitle, body].filter(Boolean).join('\n\n'),
            ctaLabel: noticeBlock.ctaLabel,
            targetType: noticeBlock.targetType,
            targetValue: noticeBlock.targetValue,
            linkUrl: null,
        },
    ];
}

export function NoticeDetailSheet({
    item,
    language,
    onClose,
    onFollowTarget,
}: {
    item: HomeNoticeItem;
    language: StorefrontLanguage;
    onClose: () => void;
    onFollowTarget: () => void;
}) {
    const isZh = language === 'zh';
    const hasTarget =
        Boolean(item.linkUrl) || (item.targetType !== 'NONE' && Boolean(item.targetValue?.trim()));
    const actionLabel =
        item.ctaLabel.trim() ||
        (item.linkUrl ? (isZh ? '前往链接' : 'Open link') : isZh ? '查看详情' : 'View details');

    return (
        <Sheet
            title={item.title || (isZh ? '公告详情' : 'Notice details')}
            language={language}
            onClose={onClose}
        >
            <div className="notice-detail-content">
                {item.content.trim() ? (
                    <p className="notice-detail-body">{item.content}</p>
                ) : (
                    <p className="notice-detail-body notice-detail-empty">
                        {isZh ? '此公告暂无更多内容。' : 'There are no additional details for this notice.'}
                    </p>
                )}
                {hasTarget ? (
                    <div className="notice-detail-actions">
                        <button
                            className="notice-detail-action"
                            type="button"
                            onClick={() => {
                                onClose();
                                onFollowTarget();
                            }}
                        >
                            <span>{actionLabel}</span>
                            {item.linkUrl ? (
                                <ExternalLink aria-hidden="true" />
                            ) : (
                                <ChevronRight aria-hidden="true" />
                            )}
                        </button>
                    </div>
                ) : null}
            </div>
        </Sheet>
    );
}

export function CurrencySelectionSheet({
    currencyCodes,
    selectedCurrencyCode,
    currencyLoading,
    language,
    onSelect,
    onClose,
}: {
    currencyCodes: string[];
    selectedCurrencyCode: string;
    currencyLoading: boolean;
    language: StorefrontLanguage;
    onSelect: (currencyCode: string) => void;
    onClose: () => void;
}) {
    const isZh = language === 'zh';

    return (
        <Sheet
            title={isZh ? '选择显示币种' : 'Choose display currency'}
            language={language}
            onClose={onClose}
            className="currency-sheet"
        >
            <div
                className="currency-sheet-options"
                role="radiogroup"
                aria-label={isZh ? '显示币种' : 'Display currency'}
                aria-busy={currencyLoading}
            >
                {currencyCodes.map(currencyCode => {
                    const selected = currencyCode === selectedCurrencyCode;
                    return (
                        <button
                            key={currencyCode}
                            className={`currency-sheet-option${selected ? ' is-selected' : ''}`}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={currencyLoading}
                            onClick={() => {
                                onSelect(currencyCode);
                                onClose();
                            }}
                        >
                            <span className="currency-sheet-option-copy">
                                <strong>{currencyCode}</strong>
                                {currencyCode === 'USDT' ? (
                                    <small>
                                        {isZh
                                            ? '参考价格，结算币种不变'
                                            : 'Reference price; settlement currency is unchanged'}
                                    </small>
                                ) : null}
                            </span>
                            {selected ? <Check aria-hidden="true" /> : null}
                        </button>
                    );
                })}
            </div>
        </Sheet>
    );
}

function HomepageCouponHub({
    block,
    coupons,
    language,
    loading,
    queryLoading,
    queryError,
    onClaim,
    onRetry,
    onToast,
}: HomepageCouponHubProps) {
    const navigate = useNavigate();
    const isZh = language === 'zh';
    const [claimingId, setClaimingId] = useState<string | null>(null);
    const handleClaim = async (coupon: StorefrontCouponCard) => {
        if (!coupon.claimable || claimingId) return;
        setClaimingId(coupon.id);
        const error = await onClaim(coupon.campaignId);
        setClaimingId(null);
        if (error && onToast) onToast(error);
    };

    return (
        <section className="coupon-hub-section" aria-label={isZh ? '专享特惠与优惠券' : 'Exclusive Coupons'}>
            <div className="coupon-hub-header">
                <div className="coupon-hub-title-lockup">
                    <span className="coupon-hub-icon-pill" aria-hidden="true">
                        <Tag size={13} />
                    </span>
                    <h2 className="coupon-hub-title">
                        {block?.title || (isZh ? '专享特惠专区' : 'Exclusive Coupons')}
                    </h2>
                </div>
                <button
                    type="button"
                    className="coupon-hub-more-btn"
                    onClick={() => void navigate(routeNavigateOptions({ name: 'coupons' }) as never)}
                >
                    <span>{isZh ? '全部优惠' : 'All Offers'}</span>
                    <ChevronRight size={13} aria-hidden="true" />
                </button>
            </div>

            {queryError ? (
                <div className="coupon-hub-query-state">
                    <InlineError message={queryError} action={isZh ? '重试' : 'Retry'} onAction={onRetry} />
                </div>
            ) : null}
            {queryLoading && coupons.length === 0 ? (
                <div className="coupon-hub-query-state">
                    <PageSkeleton label={isZh ? '正在加载优惠活动' : 'Loading coupon offers'} />
                </div>
            ) : (
                <div className="coupon-hub-scroll" role="list">
                    {coupons.map(coupon => {
                        const canClaim = coupon.claimable && !coupon.claimed;

                        return (
                            <div
                                key={coupon.id}
                                className={`coupon-ticket-card coupon-ticket-${coupon.theme} ${!canClaim ? 'is-claimed' : ''}`}
                                role="listitem"
                            >
                                <div className="coupon-ticket-main">
                                    <div className="coupon-ticket-top">
                                        <span className="coupon-ticket-tag">{coupon.tag}</span>
                                    </div>
                                    <div
                                        className={`coupon-ticket-value${
                                            coupon.unitBefore ? ' is-unit-before' : ''
                                        }`}
                                    >
                                        <Badge className="coupon-ticket-seal" aria-hidden="true" />
                                        {coupon.unitBefore ? (
                                            <>
                                                <small className="coupon-unit">{coupon.unit}</small>
                                                <strong className="coupon-num">{coupon.value}</strong>
                                            </>
                                        ) : (
                                            <>
                                                <strong className="coupon-num">{coupon.value}</strong>
                                                {coupon.unit && (
                                                    <small className="coupon-unit">{coupon.unit}</small>
                                                )}
                                            </>
                                        )}
                                    </div>
                                    <p className="coupon-ticket-desc">{coupon.description}</p>
                                </div>

                                <div className="coupon-ticket-action">
                                    <button
                                        type="button"
                                        className={`coupon-claim-btn ${!canClaim ? 'is-claimed' : ''}`}
                                        onClick={() => void handleClaim(coupon)}
                                        disabled={!canClaim || loading || claimingId !== null}
                                        aria-label={
                                            !canClaim
                                                ? isZh
                                                    ? `已领取 ${coupon.title}`
                                                    : `Claimed ${coupon.title}`
                                                : isZh
                                                  ? `领取 ${coupon.title}`
                                                  : `Claim ${coupon.title}`
                                        }
                                    >
                                        {!canClaim ? (
                                            <Check size={16} strokeWidth={2.6} aria-hidden="true" />
                                        ) : (
                                            <ChevronRight size={17} strokeWidth={2.4} aria-hidden="true" />
                                        )}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}

export interface HomePageProps {
    products: Product[];
    collections: CollectionSummary[];
    contentBlocks: StorefrontContentBlock[];
    managedContentProducts: Product[];
    heroAutoplayIntervalSeconds: number;
    configuredBlockTypes: Array<StorefrontContentBlock['type']>;
    coupons: StorefrontCouponCampaign[];
    couponCampaignsLoading: boolean;
    couponCampaignsError: string;
    flashSales: StorefrontFlashSale[];
    systemAnnouncements: StorefrontSystemAnnouncement[];
    bestSellerProducts: Product[];
    recommendationProducts: Product[];
    contentError: string;
    loading: boolean;
    error: string | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    storefrontName: string;
    storefrontDescription: string;
    storefrontTagline: string;
    logoUrl: string | null;
    logoOnLightUrl: string | null;
    couponLoading: boolean;
    onCategorySelect: (collection: CollectionSummary) => void;
    onToggleLanguage: () => void;
    availableCurrencyCodes: string[];
    currencySelectorEnabled: boolean;
    displayCurrencyCode: string;
    currencyLoading: boolean;
    onCurrencyChange: (currencyCode: string) => void;
    onNotifications: () => void;
    onToast?: (message: string) => void;
    onClaimCoupon: (campaignId: string) => Promise<string | null>;
    onCouponCampaignsRetry: () => void;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
    onContentRetry: () => void;
    onRetry: () => void;
}

export function HomePage({ embedded = false }: { embedded?: boolean } = {}) {
    const PageTag = embedded ? 'section' : 'main';
    const navigate = useNavigate();
    const navigateTo = (route: RouteState) => void navigate(routeNavigateOptions(route) as never);
    const {
        products,
        contentBlocks,
        managedContentProducts,
        heroAutoplayIntervalSeconds,
        configuredBlockTypes,
        coupons,
        couponCampaignsLoading,
        couponCampaignsError,
        flashSales,
        systemAnnouncements,
        bestSellerProducts,
        recommendationProducts,
        contentError,
        loading,
        error,
        market,
        locale,
        language,
        storefrontName,
        storefrontDescription,
        storefrontTagline,
        logoUrl,
        couponLoading,
        onToggleLanguage,
        availableCurrencyCodes,
        currencySelectorEnabled,
        displayCurrencyCode,
        currencyLoading,
        onCurrencyChange,
        onNotifications,
        onToast,
        onClaimCoupon,
        onCouponCampaignsRetry,
        onContentTarget,
        onContentRetry,
        onRetry,
    } = HomePageContext.useValue();
    const isZh = language === 'zh';
    const noticeBlock = contentBlocks.find(block => block.type === 'NOTICE');
    const managedHeroes = useMemo(
        () => contentBlocks.filter(block => block.type === 'HERO' && Boolean(block.imageUrl?.trim())),
        [contentBlocks],
    );
    const quickBlock = contentBlocks.find(block => block.type === 'QUICK_LINKS');
    const couponBlock = contentBlocks.find(block => block.type === 'COUPONS');
    const flashSaleBlock = contentBlocks.find(block => block.type === 'FLASH_SALE');
    const bestSellersBlock = contentBlocks.find(block => block.type === 'BEST_SELLERS');
    const recommendationsBlock = contentBlocks.find(block => block.type === 'RECOMMENDATIONS');
    const trustBlock = contentBlocks.find(block => block.type === 'TRUST_BAR');
    const coreCategoriesBlock = contentBlocks.find(block => block.type === 'CORE_CATEGORIES');
    const legalBlock = contentBlocks.find(block => block.type === 'LEGAL');
    const bestSellersTitle = resolveManagedContentCopy(bestSellersBlock, 'title', '');
    const homepageModules = homepageModuleEntries(contentBlocks, configuredBlockTypes);
    const homepageModuleOrder = (type: StorefrontContentBlock['type'], blockId?: string) =>
        homepageModules.findIndex(
            entry => entry.type === type && (blockId === undefined || entry.block?.id === blockId),
        );
    const hasHomepageModule = (type: StorefrontContentBlock['type']) => homepageModuleOrder(type) >= 0;
    const managedSections = homepageModules.flatMap(entry =>
        entry.block && ['CATEGORY_AD', 'FEATURED_COLLECTION', 'STORY', 'CUSTOM'].includes(entry.type)
            ? [entry.block]
            : [],
    );
    const managedContentProductPool = Array.from(
        new Map([...products, ...managedContentProducts].map(product => [product.id, product])).values(),
    );
    const [heroIndex, setHeroIndex] = useState(0);
    const [heroInteractionPaused, setHeroInteractionPaused] = useState(false);
    const [noticeIndex, setNoticeIndex] = useState(0);
    const [openNoticeId, setOpenNoticeId] = useState<string | null>(null);
    const [currencySheetOpen, setCurrencySheetOpen] = useState(false);
    const [heroGestureActive, setHeroGestureActive] = useState(false);
    const [heroAutoplayStopped, setHeroAutoplayStopped] = useState(false);
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
    const [pageVisible, setPageVisible] = useState(true);
    const heroGestureRef = useRef({
        active: false,
        horizontal: false,
        suppressClick: false,
        startX: 0,
        startY: 0,
    });
    const heroTransitionRef = useRef(0);
    const heroCount = managedHeroes.length;
    const desktopIntroOrder = heroCount > 0 ? desktopIntroModuleOrder(homepageModules) : null;
    const managedHero = managedHeroes[heroIndex];
    const isVipTheme = normalizedHeroThemePreset(managedHero?.settings?.themePreset) === 'warm';
    const managedHeroProduct =
        managedHero?.targetType === 'PRODUCT'
            ? managedContentProductPool.find(product => product.id === managedHero.targetValue)
            : undefined;
    const hero = managedHeroProduct;
    const heroImage = managedHero?.imageUrl ?? '';
    const heroStyle = managedHero ? heroThemeStyle(managedHero) : undefined;
    const showHeroImageOverlay = managedHero ? heroUsesImageOverlay(managedHero) : false;
    const noticeItems = buildHomeNoticeItems(systemAnnouncements, noticeBlock, language);
    const defaultNoticeItem: HomeNoticeItem = {
        id: 'default-notice',
        summary: isZh ? '现货商品配送时效以结算页为准' : 'Delivery timing is confirmed at checkout',
        title: isZh ? '配送说明' : 'Delivery notice',
        content: isZh
            ? '现货商品配送时效以结算页显示的信息为准。'
            : 'Delivery timing for in-stock items is confirmed at checkout.',
        ctaLabel: '',
        targetType: 'NONE',
        targetValue: null,
        linkUrl: null,
    };
    const activeNoticeItem = noticeItems[noticeIndex % Math.max(1, noticeItems.length)] ?? defaultNoticeItem;
    const openNoticeItem =
        openNoticeId === defaultNoticeItem.id
            ? defaultNoticeItem
            : noticeItems.find(item => item.id === openNoticeId);
    const showFooter = Boolean(legalBlock) || !configuredBlockTypes.includes('LEGAL');
    const campaignCouponCards = couponCardsFromCampaigns(
        claimableCouponCampaigns(coupons),
        language,
        market.currencyCode,
        displayCurrencyCode,
    );
    const couponCards = campaignCouponCards.filter(
        (coupon, index, items) =>
            items.findIndex(candidate => candidate.campaignId === coupon.campaignId) === index,
    );
    const allFlashSaleItems = flashSales
        .flatMap(sale => sale.items)
        .filter(
            (item, index, items) =>
                items.findIndex(candidate => candidate.productVariantId === item.productVariantId) === index,
        );
    const configuredFlashSaleDisplayCount = flashSaleBlock?.settings?.displayCount;
    const flashSaleItems = allFlashSaleItems.slice(
        0,
        configuredFlashSaleDisplayCount == null
            ? allFlashSaleItems.length
            : Math.max(1, contentNumberSetting(configuredFlashSaleDisplayCount, allFlashSaleItems.length)),
    );
    const noticeIntervalSeconds = Math.min(
        30,
        Math.max(3, contentNumberSetting(noticeBlock?.settings?.scrollIntervalSeconds, 5)),
    );

    const showPreparedHero = useCallback(
        async (nextIndex: number) => {
            const nextHero = managedHeroes[nextIndex];
            if (!nextHero) return;
            const transitionId = ++heroTransitionRef.current;
            const nextImage = nextHero.imageUrl ?? '';
            try {
                await decodeStorefrontImage(nextImage, 'hero');
            } catch {
                // SafeImage shows an unavailable-image placeholder when the saved image fails.
            }
            if (heroTransitionRef.current === transitionId) setHeroIndex(nextIndex);
        },
        [managedHeroes],
    );

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        const updateMotionPreference = () => setPrefersReducedMotion(mediaQuery.matches);
        updateMotionPreference();
        mediaQuery.addEventListener('change', updateMotionPreference);
        return () => mediaQuery.removeEventListener('change', updateMotionPreference);
    }, []);

    useEffect(() => {
        const updatePageVisibility = () => setPageVisible(!document.hidden);
        updatePageVisibility();
        document.addEventListener('visibilitychange', updatePageVisibility);
        return () => document.removeEventListener('visibilitychange', updatePageVisibility);
    }, []);

    useEffect(() => {
        if (noticeItems.length < 2 || openNoticeId || prefersReducedMotion || !pageVisible) {
            return;
        }
        const timer = window.setInterval(
            () => setNoticeIndex(index => (index + 1) % noticeItems.length),
            noticeIntervalSeconds * 1000,
        );
        return () => window.clearInterval(timer);
    }, [noticeIntervalSeconds, noticeItems.length, openNoticeId, pageVisible, prefersReducedMotion]);

    useEffect(() => {
        if (noticeIndex >= noticeItems.length) setNoticeIndex(0);
    }, [noticeIndex, noticeItems.length]);

    useEffect(() => {
        if (
            heroCount < 2 ||
            heroInteractionPaused ||
            heroGestureActive ||
            heroAutoplayStopped ||
            prefersReducedMotion ||
            !pageVisible
        ) {
            return;
        }
        const timer = window.setTimeout(
            () => void showPreparedHero(heroIndexAfterManualMove(heroIndex, heroCount, 1)),
            heroAutoplayIntervalSeconds * 1000,
        );
        return () => window.clearTimeout(timer);
    }, [
        heroAutoplayIntervalSeconds,
        heroAutoplayStopped,
        heroCount,
        heroGestureActive,
        heroIndex,
        heroInteractionPaused,
        pageVisible,
        prefersReducedMotion,
        showPreparedHero,
    ]);

    useEffect(() => {
        if (heroCount < 2 || !shouldPrefetchMedia()) return;
        const nextIndex = heroIndexAfterManualMove(heroIndex, heroCount, 1);
        const nextHero = managedHeroes[nextIndex];
        if (!nextHero) return;
        const nextImage = nextHero.imageUrl ?? '';
        void decodeStorefrontImage(nextImage, 'hero').catch(() => undefined);
    }, [heroCount, heroIndex, managedHeroes]);

    useEffect(() => {
        if (heroIndex >= heroCount) setHeroIndex(0);
    }, [heroCount, heroIndex]);

    const selectHeroManually = (index: number) => {
        setHeroAutoplayStopped(true);
        void showPreparedHero(index);
    };

    const openActiveHero = () => {
        if (managedHero?.targetType && managedHero.targetType !== 'NONE' && managedHero.targetValue) {
            onContentTarget(managedHero.targetType, managedHero.targetValue);
        } else if (hero) {
            navigateTo({ name: 'product', id: hero.id });
        } else {
            navigateTo({ name: 'category' });
        }
    };

    const handleHeroImageOpen = () => {
        if (heroGestureRef.current.suppressClick) {
            heroGestureRef.current.suppressClick = false;
            return;
        }
        openActiveHero();
    };

    const beginHeroSwipe = (event: ReactPointerEvent<HTMLElement>) => {
        const interactiveTarget =
            event.target instanceof Element ? event.target.closest('button, a, input, label') : null;
        const isHeroImageLink = interactiveTarget?.classList.contains('hero-rich-image-link');
        if (heroCount < 2 || event.button !== 0 || (interactiveTarget && !isHeroImageLink)) {
            return;
        }
        heroGestureRef.current = {
            active: true,
            horizontal: false,
            suppressClick: false,
            startX: event.clientX,
            startY: event.clientY,
        };
        setHeroGestureActive(true);
        event.currentTarget.classList.add('is-dragging');
    };

    const moveHeroSwipe = (event: ReactPointerEvent<HTMLElement>) => {
        const gesture = heroGestureRef.current;
        if (!gesture.active) return;
        const deltaX = event.clientX - gesture.startX;
        const deltaY = event.clientY - gesture.startY;
        if (!gesture.horizontal) {
            if (Math.abs(deltaY) > Math.abs(deltaX) + 6) {
                gesture.active = false;
                setHeroGestureActive(false);
                event.currentTarget.classList.remove('is-dragging');
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }
                return;
            }
            if (Math.abs(deltaX) < 6) return;
            gesture.horizontal = true;
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        event.preventDefault();
    };

    const finishHeroSwipe = (event: ReactPointerEvent<HTMLElement>, cancelled = false) => {
        const gesture = heroGestureRef.current;
        if (!gesture.active && !gesture.horizontal) return;
        const deltaX = event.clientX - gesture.startX;
        const deltaY = event.clientY - gesture.startY;
        const completed = !cancelled && gesture.horizontal && isCompletedHeroSwipe(deltaX, deltaY);
        const suppressClick = gesture.horizontal;
        gesture.active = false;
        gesture.horizontal = false;
        gesture.suppressClick = suppressClick;
        setHeroGestureActive(false);
        event.currentTarget.classList.remove('is-dragging');
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (completed) {
            selectHeroManually(heroIndexAfterManualMove(heroIndex, heroCount, deltaX < 0 ? 1 : -1));
        }
        if (suppressClick) {
            window.setTimeout(() => {
                gesture.suppressClick = false;
            }, 0);
        }
    };

    const quickLinks: Array<{
        id: string;
        label: string;
        icon: ReactNode;
        disabled?: boolean;
        onClick: () => void;
    }> = (quickBlock?.items ?? []).map((item, index) => ({
        id: item.id,
        label: item.label,
        icon: renderColorfulQuickIcon(item.label, index, item.imageUrl),
        disabled: item.targetType === 'NONE' || !item.targetValue,
        onClick: () => onContentTarget(item.targetType, item.targetValue),
    }));
    const trustIcons = [ShieldCheck, Zap, Lock, Headphones];
    const trustItems = (trustBlock?.items ?? []).map(item => item.label);
    const trustBarHasLongCopy = trustItems.some(label => Array.from(label.trim()).length > (isZh ? 4 : 10));
    const colorfulTrustBar = isColorfulHomepageStyle(trustBlock?.settings?.visualStyle);
    const colorfulQuickLinks = isColorfulHomepageStyle(quickBlock?.settings?.visualStyle);

    return (
        <PageTag className={`page home-page${embedded ? ' is-embedded' : ''}`}>
            <header className="topbar home-topbar">
                <button
                    className="brand"
                    type="button"
                    onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                    aria-label={
                        isZh ? `返回 ${storefrontName} 首页顶部` : `Back to the top of ${storefrontName}`
                    }
                >
                    <BrandLogo url={logoUrl} name={storefrontName} className="brand-mark" />
                    <strong>{storefrontName}</strong>
                </button>
                <div className="topbar-actions">
                    {currencySelectorEnabled && availableCurrencyCodes.length > 1 ? (
                        <button
                            className="currency-select"
                            type="button"
                            disabled={currencyLoading}
                            onClick={() => setCurrencySheetOpen(true)}
                            aria-label={isZh ? '选择显示币种' : 'Choose display currency'}
                            title={isZh ? '选择显示币种' : 'Choose display currency'}
                            aria-haspopup="dialog"
                            aria-expanded={currencySheetOpen}
                        >
                            <span>{displayCurrencyCode}</span>
                            <ChevronDown aria-hidden="true" />
                        </button>
                    ) : null}
                    <button
                        className="language-button"
                        type="button"
                        onClick={onToggleLanguage}
                        aria-label={isZh ? '切换为英文' : 'Switch to Chinese'}
                    >
                        {isZh ? '中' : 'EN'}
                    </button>
                    <NoticeButton language={language} onClick={onNotifications} />
                </div>
            </header>

            {currencySheetOpen ? (
                <CurrencySelectionSheet
                    currencyCodes={availableCurrencyCodes}
                    selectedCurrencyCode={displayCurrencyCode}
                    currencyLoading={currencyLoading}
                    language={language}
                    onSelect={onCurrencyChange}
                    onClose={() => setCurrencySheetOpen(false)}
                />
            ) : null}

            {openNoticeItem ? (
                <NoticeDetailSheet
                    item={openNoticeItem}
                    language={language}
                    onClose={() => setOpenNoticeId(null)}
                    onFollowTarget={() => {
                        if (openNoticeItem.linkUrl) window.location.assign(openNoticeItem.linkUrl);
                        else onContentTarget(openNoticeItem.targetType, openNoticeItem.targetValue);
                    }}
                />
            ) : null}

            {storefrontTagline && <p className="storefront-tagline">{storefrontTagline}</p>}
            {storefrontDescription && <p className="storefront-description">{storefrontDescription}</p>}

            {contentError && (
                <div className="content-warning" role="status">
                    <span>{isZh ? '店铺内容暂时无法加载' : 'Store content is temporarily unavailable'}</span>
                    <button type="button" onClick={onContentRetry}>
                        <RotateCcw aria-hidden="true" />
                        {isZh ? '重试' : 'Retry'}
                    </button>
                </div>
            )}

            {loading ? (
                <PageSkeleton label={isZh ? '正在加载首页' : 'Loading home page'} />
            ) : error ? (
                <EmptyState
                    icon={<WifiOff />}
                    title={isZh ? '首页加载失败' : 'Could not load the home page'}
                    detail={error}
                    action={isZh ? '重新加载' : 'Try again'}
                    onAction={onRetry}
                />
            ) : (
                <>
                    <div className="homepage-modules">
                        {hasHomepageModule('NOTICE') && noticeItems.length > 0 ? (
                            <button
                                className="notice-strip"
                                style={{ order: homepageModuleOrder('NOTICE') }}
                                type="button"
                                aria-haspopup="dialog"
                                aria-expanded={Boolean(openNoticeItem)}
                                aria-label={
                                    isZh
                                        ? `查看公告全文：${activeNoticeItem.title}`
                                        : `Read full notice: ${activeNoticeItem.title}`
                                }
                                onClick={() => setOpenNoticeId(activeNoticeItem.id)}
                            >
                                <Bell aria-hidden="true" />
                                <span key={activeNoticeItem.id}>{activeNoticeItem.summary}</span>
                                <ChevronRight aria-hidden="true" />
                            </button>
                        ) : null}
                        <div
                            className={`home-intro-grid${
                                desktopIntroOrder === null ? '' : ' is-desktop-grouped'
                            }`}
                            style={desktopIntroOrder === null ? undefined : { order: desktopIntroOrder }}
                        >
                            {hasHomepageModule('HERO') && heroCount > 0 && (
                                <section
                                    className={`hero${heroCount > 1 ? ' is-swipeable' : ''}`}
                                    style={{ ...heroStyle, order: homepageModuleOrder('HERO') }}
                                    role="region"
                                    aria-label={managedHero?.title || (isZh ? '精选推荐' : 'Featured')}
                                    aria-roledescription={isZh ? '轮播' : 'carousel'}
                                    onMouseEnter={() => setHeroInteractionPaused(true)}
                                    onMouseLeave={() => setHeroInteractionPaused(false)}
                                    onFocus={() => setHeroInteractionPaused(true)}
                                    onBlur={event => {
                                        if (!event.currentTarget.contains(event.relatedTarget)) {
                                            setHeroInteractionPaused(false);
                                        }
                                    }}
                                    onPointerDown={beginHeroSwipe}
                                    onPointerMove={moveHeroSwipe}
                                    onPointerUp={event => finishHeroSwipe(event)}
                                    onPointerCancel={event => finishHeroSwipe(event, true)}
                                    onDragStart={event => event.preventDefault()}
                                >
                                    {/* Render the image saved for this carousel slide. */}
                                    <button
                                        type="button"
                                        className="hero-rich-image-link"
                                        onClick={handleHeroImageOpen}
                                        aria-label={`${isZh ? '查看推荐内容' : 'Open featured content'}：${
                                            managedHero?.title || hero?.name || storefrontName
                                        }`}
                                    >
                                        <SafeImage
                                            src={heroImage}
                                            alt={
                                                managedHero?.title ||
                                                (isZh
                                                    ? `${storefrontName}精选`
                                                    : `${storefrontName} Featured`)
                                            }
                                            className="hero-rich-backdrop"
                                            imageKind="hero"
                                            loading="eager"
                                            fetchPriority={heroIndex === 0 ? 'high' : 'auto'}
                                        />
                                    </button>
                                    {showHeroImageOverlay ? (
                                        <div className="hero-rich-overlay-shade" />
                                    ) : null}

                                    {/* Saved copy and display settings. */}
                                    {(() => {
                                        const title = resolveManagedContentCopy(managedHero, 'title', '');
                                        const subtitle = resolveManagedContentCopy(
                                            managedHero,
                                            'subtitle',
                                            '',
                                        );
                                        const body = resolveManagedContentCopy(managedHero, 'body', '');
                                        const ctaLabel = resolveManagedContentCopy(
                                            managedHero,
                                            'ctaLabel',
                                            '',
                                        );
                                        const stats = (managedHero?.items ?? []).map(item => ({
                                            value: item.label,
                                            label: item.description,
                                        }));

                                        return (
                                            <div
                                                className={`hero-rich-content ${isVipTheme ? 'is-vip' : ''}`}
                                            >
                                                {subtitle && (
                                                    <div
                                                        className={`hero-rich-pill ${isVipTheme ? 'is-vip-pill' : ''}`}
                                                    >
                                                        {isVipTheme ? (
                                                            <ShieldCheck aria-hidden="true" />
                                                        ) : (
                                                            <Zap aria-hidden="true" />
                                                        )}
                                                        <span>{subtitle}</span>
                                                    </div>
                                                )}
                                                <h1 className="hero-rich-title">{title}</h1>
                                                {body && <p className="hero-rich-desc">{body}</p>}

                                                {stats.length > 0 && (
                                                    <div className="hero-rich-stats-row">
                                                        {stats.map((stat, index) => (
                                                            <div
                                                                className={`hero-stat-badge${isVipTheme ? ' is-vip' : ''}`}
                                                                key={`${stat.value}-${index}`}
                                                            >
                                                                <span className="stat-num">{stat.value}</span>
                                                                <span className="stat-lbl">{stat.label}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {ctaLabel && managedHero?.targetType !== 'NONE' && (
                                                    <button
                                                        type="button"
                                                        className={`hero-rich-cta-btn ${isVipTheme ? 'is-vip-btn' : ''}`}
                                                        onClick={openActiveHero}
                                                    >
                                                        {ctaLabel}
                                                        <ChevronRight aria-hidden="true" />
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })()}
                                    {heroCount > 1 && (
                                        <div
                                            className="hero-pagination"
                                            aria-label={isZh ? '轮播广告' : 'Promotion carousel'}
                                        >
                                            {managedHeroes.map((item, index) => (
                                                <button
                                                    type="button"
                                                    key={item.id}
                                                    className={`hero-dot ${index === heroIndex ? 'is-active' : ''}`}
                                                    aria-label={
                                                        isZh
                                                            ? `第${index + 1}张广告`
                                                            : `Promotion ${index + 1}`
                                                    }
                                                    aria-current={index === heroIndex}
                                                    onClick={() => selectHeroManually(index)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                    <span
                                        className="visually-hidden"
                                        aria-live={heroAutoplayStopped ? 'polite' : 'off'}
                                    >
                                        {heroAutoplayStopped
                                            ? isZh
                                                ? `自动轮播已停止，当前为第 ${heroIndex + 1} 张广告`
                                                : `Autoplay stopped. Promotion ${heroIndex + 1} is active.`
                                            : ''}
                                    </span>
                                </section>
                            )}

                            {hasHomepageModule('TRUST_BAR') && trustItems.length > 0 ? (
                                <div
                                    className={`home-trust-bar${trustBarHasLongCopy ? ' has-long-copy' : ''}${colorfulTrustBar ? ' is-color-marketplace' : ''}`}
                                    style={{ order: homepageModuleOrder('TRUST_BAR') }}
                                    aria-label={isZh ? '服务信息' : 'Service information'}
                                >
                                    {trustItems.map((label, index) => {
                                        const TrustIcon = trustIcons[index % trustIcons.length];
                                        return (
                                            <div className="home-trust-item" key={`${label}-${index}`}>
                                                <TrustIcon className="trust-icon" aria-hidden="true" />
                                                <span className="home-trust-label">{label}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : null}

                            {hasHomepageModule('QUICK_LINKS') && quickLinks.length > 0 ? (
                                <nav
                                    className={`quick-grid quick-grid-${quickLinks.length}${colorfulQuickLinks ? ' is-color-marketplace' : ''}`}
                                    style={{ order: homepageModuleOrder('QUICK_LINKS') }}
                                    aria-label={isZh ? '快捷分类' : 'Quick categories'}
                                >
                                    {quickLinks.map(item => (
                                        <button
                                            type="button"
                                            key={item.id}
                                            onClick={item.onClick}
                                            disabled={item.disabled}
                                        >
                                            <span>{item.icon}</span>
                                            <b>{item.label}</b>
                                        </button>
                                    ))}
                                </nav>
                            ) : null}
                        </div>

                        {hasHomepageModule('COUPONS') &&
                            (couponCards.length > 0 || couponCampaignsLoading || couponCampaignsError) && (
                                <div
                                    className={homepageSectionShellClassName}
                                    style={{ order: homepageModuleOrder('COUPONS') }}
                                >
                                    <HomepageCouponHub
                                        block={couponBlock}
                                        coupons={couponCards}
                                        language={language}
                                        loading={couponLoading}
                                        queryLoading={couponCampaignsLoading}
                                        queryError={couponCampaignsError}
                                        onClaim={onClaimCoupon}
                                        onRetry={onCouponCampaignsRetry}
                                        onToast={onToast}
                                    />
                                </div>
                            )}

                        {coreCategoriesBlock ? (
                            <div
                                className="homepage-module-shell"
                                style={{ order: homepageModuleOrder('CORE_CATEGORIES') }}
                            >
                                <HomeDualCategoryShowcase
                                    language={language}
                                    block={coreCategoriesBlock}
                                    onContentTarget={onContentTarget}
                                />
                            </div>
                        ) : null}

                        {managedSections.map(block => (
                            <div
                                key={block.id}
                                className={homepageSectionShellClassName}
                                style={{ order: homepageModuleOrder(block.type, block.id) }}
                            >
                                <ManagedContentSection
                                    block={block}
                                    products={managedContentProductPool}
                                    language={language}
                                    locale={locale}
                                    market={market}
                                    onContentTarget={onContentTarget}
                                />
                            </div>
                        ))}

                        {!products.length && (
                            <div
                                className={homepageSectionShellClassName}
                                style={{ order: homepageModules.length }}
                            >
                                <EmptyState
                                    icon={<ShoppingBag />}
                                    title={isZh ? '暂无在售商品' : 'No products are available'}
                                    detail={
                                        isZh
                                            ? '商家在管理后台上架商品后会显示在这里'
                                            : 'Products will appear here after the merchant publishes them'
                                    }
                                />
                            </div>
                        )}

                        {hasHomepageModule('FLASH_SALE') && flashSaleItems.length ? (
                            <div
                                className={homepageSectionShellClassName}
                                style={{ order: homepageModuleOrder('FLASH_SALE') }}
                            >
                                <FlashSaleSection
                                    title={flashSaleBlock?.title || (isZh ? '限时秒杀' : 'Flash sale')}
                                    subtitle={flashSaleBlock?.subtitle || undefined}
                                    items={flashSaleItems}
                                    locale={locale}
                                    language={language}
                                    endsAt={flashSales[0]?.endsAt ?? null}
                                    onMore={() => navigateTo({ name: 'flash-sale' })}
                                    onProduct={productId => navigateTo({ name: 'product', id: productId })}
                                />
                            </div>
                        ) : null}

                        {hasHomepageModule('BEST_SELLERS') && bestSellerProducts.length ? (
                            <div
                                className={homepageSectionShellClassName}
                                style={{ order: homepageModuleOrder('BEST_SELLERS') }}
                            >
                                <ProductSection
                                    title={bestSellersTitle}
                                    subtitle={bestSellersBlock?.subtitle}
                                    action={isZh ? '更多' : 'More'}
                                    onAction={() => navigateTo({ name: 'category', sort: 'sales' })}
                                    products={bestSellerProducts}
                                    market={market}
                                    locale={locale}
                                    language={language}
                                    onProduct={product => navigateTo({ name: 'product', id: product.id })}
                                />
                            </div>
                        ) : null}

                        {hasHomepageModule('RECOMMENDATIONS') && recommendationProducts.length ? (
                            <div
                                className={homepageSectionShellClassName}
                                style={{ order: homepageModuleOrder('RECOMMENDATIONS') }}
                            >
                                <ProductSection
                                    title={resolveManagedContentCopy(
                                        recommendationsBlock,
                                        'title',
                                        isZh ? '猜你喜欢' : 'You may also like',
                                    )}
                                    subtitle={resolveManagedContentCopy(
                                        recommendationsBlock,
                                        'subtitle',
                                        isZh ? '继续发现合适的好物' : 'Keep discovering',
                                    )}
                                    action={isZh ? '更多' : 'More'}
                                    onAction={() => navigateTo({ name: 'recommendations' })}
                                    products={recommendationProducts}
                                    market={market}
                                    locale={locale}
                                    language={language}
                                    onProduct={product => navigateTo({ name: 'product', id: product.id })}
                                />
                            </div>
                        ) : null}
                    </div>

                    {showFooter ? (
                        <LegalFooter
                            storefrontName={storefrontName}
                            language={language}
                            content={legalBlock}
                            onContentTarget={onContentTarget}
                        />
                    ) : null}
                </>
            )}
        </PageTag>
    );
}

function FlashSaleSection({
    title,
    subtitle,
    items,
    locale,
    language,
    endsAt,
    onMore,
    onProduct,
}: {
    title: string;
    subtitle?: string;
    items: StorefrontFlashSaleItem[];
    locale: string;
    language: StorefrontLanguage;
    endsAt: string | null;
    onMore?: () => void;
    onProduct: (productId: string) => void;
}) {
    const isZh = language === 'zh';
    const countdown = useFlashSaleCountdown(endsAt, language);
    if (!items.length) return null;
    return (
        <section className="content-section flash-sale-section">
            <SectionHeader
                title={title}
                subtitle={subtitle}
                action={onMore ? (isZh ? '更多' : 'More') : undefined}
                onAction={onMore}
            />
            {countdown ? (
                <div className="flash-sale-countdown" role="timer">
                    <Clock3 aria-hidden="true" />
                    <span>{isZh ? '距结束' : 'Ends in'}</span>
                    <strong>{countdown}</strong>
                </div>
            ) : null}
            <div className="flash-sale-grid">
                {items.map(item => (
                    <button
                        type="button"
                        className="flash-sale-card"
                        key={item.productVariantId}
                        onClick={() => onProduct(item.productId)}
                        aria-label={`${isZh ? '查看秒杀商品' : 'View flash-sale product'} ${item.productName}`}
                    >
                        <span className="flash-sale-image">
                            {item.imageUrl ? (
                                <SafeImage
                                    src={item.imageUrl}
                                    alt={item.productName}
                                    imageKind="card"
                                    loading="lazy"
                                />
                            ) : (
                                <span className="image-placeholder" aria-hidden="true">
                                    <Package />
                                </span>
                            )}
                            <em>{isZh ? '限时价' : 'Limited price'}</em>
                        </span>
                        <strong className="flash-sale-name">{item.productName}</strong>
                        {item.variantName && item.variantName !== item.productName ? (
                            <small>{item.variantName}</small>
                        ) : null}
                        <span className="flash-sale-price">
                            <b>{formatMoney(item.salePrice, item.currencyCode, locale)}</b>
                            <del>{formatMoney(item.originalPrice, item.currencyCode, locale)}</del>
                        </span>
                    </button>
                ))}
            </div>
        </section>
    );
}

function FlashSalePage({
    sales,
    language,
    locale,
    onBack,
    onProduct,
}: {
    sales: StorefrontFlashSale[];
    language: StorefrontLanguage;
    locale: string;
    onBack: () => void;
    onProduct: (productId: string) => void;
}) {
    const isZh = language === 'zh';
    const items = sales
        .flatMap(sale => sale.items)
        .filter(
            (item, index, allItems) =>
                allItems.findIndex(candidate => candidate.productVariantId === item.productVariantId) ===
                index,
        );
    return (
        <Subpage title={isZh ? '限时秒杀' : 'Flash sale'} language={language} onBack={onBack}>
            {items.length ? (
                <FlashSaleSection
                    title={isZh ? '限时秒杀' : 'Flash sale'}
                    subtitle={
                        isZh
                            ? '活动价格会在购物车和结算页自动生效'
                            : 'Sale prices apply automatically in cart and checkout'
                    }
                    items={items}
                    locale={locale}
                    language={language}
                    endsAt={sales[0]?.endsAt ?? null}
                    onProduct={onProduct}
                />
            ) : (
                <EmptyState
                    icon={<Flame />}
                    title={isZh ? '暂无进行中的秒杀' : 'No active flash sale'}
                    detail={
                        isZh
                            ? '请留意首页和店铺公告中的下次活动'
                            : 'Check the home page and store announcements for the next event'
                    }
                />
            )}
        </Subpage>
    );
}

function RecommendationPage({
    products,
    block,
    market,
    locale,
    language,
    onBack,
    onProduct,
}: {
    products: Product[];
    block?: StorefrontContentBlock;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    onBack: () => void;
    onProduct: (product: Product) => void;
}) {
    const isZh = language === 'zh';
    return (
        <Subpage
            title={resolveManagedContentCopy(block, 'title', isZh ? '猜你喜欢' : 'You may also like')}
            language={language}
            onBack={onBack}
        >
            {products.length ? (
                <ProductSection
                    subtitle={resolveManagedContentCopy(
                        block,
                        'subtitle',
                        isZh
                            ? '结合你的购买品类和浏览记录推荐'
                            : 'Based on your purchase categories and browsing history',
                    )}
                    products={products}
                    market={market}
                    locale={locale}
                    language={language}
                    onProduct={onProduct}
                />
            ) : (
                <EmptyState
                    icon={<Sparkles />}
                    title={isZh ? '暂无推荐商品' : 'No recommendations yet'}
                    detail={
                        isZh
                            ? '浏览或购买商品后，这里会显示更符合你喜好的内容'
                            : 'Browse or purchase products to improve these recommendations'
                    }
                />
            )}
        </Subpage>
    );
}

function HomeDualCategoryShowcase({
    language,
    block,
    onContentTarget,
}: {
    language: StorefrontLanguage;
    block: StorefrontContentBlock;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}) {
    const isZh = language === 'zh';
    if (!block.items.length) return null;
    const template = dualCardTemplateSetting(block.settings);

    return (
        <section
            className="home-dual-showcase"
            data-card-template={template}
            aria-label={block.title || (isZh ? '核心品类精选' : 'Core Categories')}
        >
            {block.items.slice(0, 2).map((item, index) => {
                const disabled = item.targetType === 'NONE' || !item.targetValue;
                const ShowcaseIcon = index === 0 ? Waypoints : Headphones;
                const badgeLabel = localizedDualCardItemSetting(
                    item.settings,
                    'badgeLabel',
                    language,
                    block.subtitle || (isZh ? '核心品类' : 'Core category'),
                );
                const ctaLabel = localizedDualCardItemSetting(
                    item.settings,
                    'ctaLabel',
                    language,
                    block.ctaLabel || (isZh ? '查看分类' : 'View category'),
                );
                return (
                    <button
                        key={item.id}
                        type="button"
                        className={`showcase-card showcase-card--${index === 0 ? 'gateway' : 'support'}${item.imageUrl ? ' has-managed-image' : ''}`}
                        disabled={disabled}
                        onClick={() => onContentTarget(item.targetType, item.targetValue)}
                    >
                        {item.imageUrl ? (
                            <>
                                <span className="showcase-card-media" aria-hidden="true">
                                    <SafeImage src={item.imageUrl} alt="" imageKind="card" loading="lazy" />
                                </span>
                                <span className="showcase-card-image-shade" aria-hidden="true" />
                            </>
                        ) : null}
                        {template === 'tech-duo' ? (
                            <span className="showcase-card-icon" aria-hidden="true">
                                <ShowcaseIcon />
                            </span>
                        ) : null}
                        <div className="showcase-content">
                            {badgeLabel ? <span className="showcase-badge">{badgeLabel}</span> : null}
                            <h3>{item.label}</h3>
                            {item.description ? <p>{item.description}</p> : null}
                            {!disabled && ctaLabel ? (
                                <span className="showcase-link">
                                    {ctaLabel} <ChevronRight aria-hidden="true" />
                                </span>
                            ) : null}
                        </div>
                    </button>
                );
            })}
        </section>
    );
}

function HomeTrustGuaranteeStrip({ language }: { language: StorefrontLanguage }) {
    const isZh = language === 'zh';
    return (
        <section className="home-trust-strip" aria-label={isZh ? '购物信息' : 'Shopping information'}>
            <div className="trust-item item-genuine">
                <div className="trust-icon-box">
                    <CircleCheck aria-hidden="true" />
                </div>
                <div className="trust-text">
                    <strong>{isZh ? '商品信息' : 'Product details'}</strong>
                    <small>{isZh ? '价格库存以详情为准' : 'Current price and stock'}</small>
                </div>
            </div>
            <div className="trust-item item-delivery">
                <div className="trust-icon-box">
                    <Download aria-hidden="true" />
                </div>
                <div className="trust-text">
                    <strong>{isZh ? '订单交付' : 'Order delivery'}</strong>
                    <small>{isZh ? '数字交付状态订单内可查' : 'Digital status appears in orders'}</small>
                </div>
            </div>
            <div className="trust-item item-shipping">
                <div className="trust-icon-box">
                    <Truck aria-hidden="true" />
                </div>
                <div className="trust-text">
                    <strong>{isZh ? '配送跟踪' : 'Delivery tracking'}</strong>
                    <small>{isZh ? '发货后查看物流轨迹' : 'Track physical shipments'}</small>
                </div>
            </div>
            <div className="trust-item item-support">
                <div className="trust-icon-box">
                    <RotateCcw aria-hidden="true" />
                </div>
                <div className="trust-text">
                    <strong>{isZh ? '售后入口' : 'Returns'}</strong>
                    <small>{isZh ? '可在订单内提交申请' : 'Request a return from an order'}</small>
                </div>
            </div>
        </section>
    );
}

function ManagedContentSection({
    block,
    products,
    language,
    locale,
    market,
    onContentTarget,
}: {
    block: StorefrontContentBlock;
    products: Product[];
    language: StorefrontLanguage;
    locale: string;
    market: MarketConfig;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}) {
    const blockHasTarget = block.targetType !== 'NONE' && Boolean(block.targetValue);
    const displayCount = Math.min(50, Math.max(1, contentNumberSetting(block.settings?.displayCount, 8)));
    const selectedProductIds = contentStringArraySetting(block.settings?.selectedProductIds);
    const selectedProducts = selectManagedProducts({
        productIds: selectedProductIds,
        products,
        count: displayCount,
    });
    const itemProductIds = new Set(
        block.items.flatMap(item =>
            item.targetType === 'PRODUCT' && item.targetValue ? [item.targetValue] : [],
        ),
    );
    const additionalSelectedProducts = selectedProducts.filter(product => !itemProductIds.has(product.id));
    const blockTargetProduct =
        block.targetType === 'PRODUCT'
            ? products.find(product => product.id === block.targetValue)
            : undefined;
    if (block.type === 'CATEGORY_AD') {
        return (
            <CategoryPromotionSection
                block={block}
                products={products}
                language={language}
                locale={locale}
                market={market}
                onContentTarget={onContentTarget}
            />
        );
    }
    if (block.type === 'FEATURED_COLLECTION') {
        return (
            <FeaturedCollectionSection
                block={block}
                products={additionalSelectedProducts}
                language={language}
                locale={locale}
                onContentTarget={onContentTarget}
            />
        );
    }
    if (block.type === 'STORY') {
        return <ContentStorySection block={block} language={language} onContentTarget={onContentTarget} />;
    }
    return (
        <section
            className={`content-section managed-content-section managed-content-${block.type.toLowerCase()}`}
            style={{
                backgroundColor: block.backgroundColor ?? undefined,
                color: block.textColor ?? undefined,
            }}
        >
            <SectionHeader
                title={block.title}
                subtitle={block.subtitle}
                action={blockHasTarget ? block.ctaLabel || undefined : undefined}
                onAction={
                    blockHasTarget ? () => onContentTarget(block.targetType, block.targetValue) : undefined
                }
            />
            {block.body && <p className="managed-content-body">{block.body}</p>}
            {block.imageUrl && !block.items.length && !additionalSelectedProducts.length && (
                <button
                    className="managed-content-banner"
                    type="button"
                    disabled={!blockHasTarget}
                    onClick={() => onContentTarget(block.targetType, block.targetValue)}
                >
                    <SafeImage
                        src={block.imageUrl}
                        fallbackSrc={productImage(blockTargetProduct) ?? undefined}
                        alt={block.title}
                        imageKind="hero"
                        loading="lazy"
                    />
                </button>
            )}
            {!!(block.items.length || additionalSelectedProducts.length) && (
                <div className="managed-content-grid">
                    {block.items.map(item => (
                        <ManagedContentItemButton
                            key={item.id}
                            item={item}
                            products={products}
                            onContentTarget={onContentTarget}
                        />
                    ))}
                    {additionalSelectedProducts.map(product => (
                        <ManagedSelectedProductButton
                            key={product.id}
                            product={product}
                            onContentTarget={onContentTarget}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}

function CategoryPromotionSection({
    block,
    products,
    language,
    locale,
    market,
    onContentTarget,
}: {
    block: StorefrontContentBlock;
    products: Product[];
    language: StorefrontLanguage;
    locale: string;
    market: MarketConfig;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}) {
    const isZh = language === 'zh';
    const blockHasTarget = block.targetType !== 'NONE' && Boolean(block.targetValue);
    const displayCount = Math.min(4, Math.max(1, contentNumberSetting(block.settings?.displayCount, 4)));
    const categoryProducts = selectCategoryPromotionProducts({
        selectedProductIds: contentStringArraySetting(block.settings?.selectedProductIds),
        products,
        targetType: block.targetType,
        targetValue: block.targetValue,
        count: displayCount,
    });
    const productGridCount = Math.max(1, Math.min(4, categoryProducts.length));
    const hasSupportingContent = categoryProducts.length > 0 || block.items.length > 0;
    const colorfulMarketplace = isColorfulHomepageStyle(block.settings?.visualStyle);
    const sectionClassName = `content-section managed-content-section managed-content-category_ad category-promotion-section${
        colorfulMarketplace ? ' is-color-marketplace' : ''
    }`;

    return (
        <section
            className={sectionClassName}
            style={{
                backgroundColor: block.backgroundColor ?? undefined,
                color: block.textColor ?? undefined,
            }}
        >
            <SectionHeader title={block.title} subtitle={block.subtitle} subtitlePlacement="end" />
            <div className={`category-promotion-layout${hasSupportingContent ? '' : ' is-visual-only'}`}>
                <button
                    className="category-promotion-visual"
                    type="button"
                    disabled={!blockHasTarget}
                    onClick={() => onContentTarget(block.targetType, block.targetValue)}
                    aria-label={
                        blockHasTarget ? (isZh ? `打开${block.title}` : `Open ${block.title}`) : block.title
                    }
                >
                    {block.imageUrl ? (
                        <SafeImage src={block.imageUrl} alt={block.title} imageKind="hero" loading="lazy" />
                    ) : (
                        <span className="category-promotion-placeholder" aria-hidden="true">
                            <LayoutGrid />
                        </span>
                    )}
                    <span className="category-promotion-visual-copy" aria-hidden="true">
                        <small>{isZh ? '热门服务' : 'Featured service'}</small>
                    </span>
                </button>

                {categoryProducts.length ? (
                    <div
                        className={`product-grid category-promotion-products category-promotion-products-${productGridCount}`}
                    >
                        {categoryProducts.map(product => (
                            <ProductCard
                                key={product.id}
                                product={product}
                                market={market}
                                locale={locale}
                                language={language}
                                onOpen={() => onContentTarget('PRODUCT', product.id)}
                            />
                        ))}
                    </div>
                ) : block.items.length ? (
                    <div className="managed-content-grid category-promotion-legacy-grid">
                        {block.items.map(item => (
                            <ManagedContentItemButton
                                key={item.id}
                                item={item}
                                products={products}
                                onContentTarget={onContentTarget}
                            />
                        ))}
                    </div>
                ) : null}
            </div>
        </section>
    );
}

function FeaturedCollectionSection({
    block,
    products,
    language,
    locale,
    onContentTarget,
}: {
    block: StorefrontContentBlock;
    products: Product[];
    language: StorefrontLanguage;
    locale: string;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}) {
    const isZh = language === 'zh';
    const blockHasTarget = block.targetType !== 'NONE' && Boolean(block.targetValue);
    const mosaicProducts = products.slice(0, 5);

    return (
        <section
            className="content-section featured-collection-section"
            aria-labelledby={`${block.id}-title`}
        >
            <div className="featured-collection-layout">
                <div
                    className="featured-collection-intro"
                    style={{
                        backgroundColor: block.backgroundColor ?? undefined,
                        color: block.textColor ?? undefined,
                    }}
                >
                    <h2 id={`${block.id}-title`}>{block.title}</h2>
                    {block.subtitle ? <p className="featured-collection-subtitle">{block.subtitle}</p> : null}
                    {block.body ? <p className="featured-collection-body">{block.body}</p> : null}
                    {blockHasTarget ? (
                        <button
                            className="featured-collection-action"
                            type="button"
                            onClick={() => onContentTarget(block.targetType, block.targetValue)}
                        >
                            {block.ctaLabel || (isZh ? '浏览全部' : 'View collection')}
                            <ChevronRight aria-hidden="true" />
                        </button>
                    ) : null}
                </div>

                {mosaicProducts.length ? (
                    <div
                        className="featured-collection-mosaic"
                        data-product-count={mosaicProducts.length}
                        aria-label={block.title}
                    >
                        {mosaicProducts.map((product, index) => {
                            const imageUrl = productImage(product);
                            const pricedVariant = product.variants.find(
                                variant => variant.priceWithTax === minimumProductPrice(product),
                            );
                            const priceLabel = pricedVariant
                                ? formatMoney(pricedVariant.priceWithTax, pricedVariant.currencyCode, locale)
                                : null;
                            return (
                                <button
                                    key={product.id}
                                    className={`featured-collection-product${index === 0 ? ' is-featured' : ''}`}
                                    type="button"
                                    onClick={() => onContentTarget('PRODUCT', product.id)}
                                    aria-label={priceLabel ? `${product.name} ${priceLabel}` : product.name}
                                >
                                    <span className="featured-collection-product-media">
                                        {imageUrl ? (
                                            <SafeImage
                                                src={imageUrl}
                                                alt={product.name}
                                                imageKind="card"
                                                loading="lazy"
                                            />
                                        ) : (
                                            <span className="featured-collection-product-placeholder">
                                                <LayoutGrid aria-hidden="true" />
                                            </span>
                                        )}
                                        <span
                                            className="featured-collection-product-overlay"
                                            aria-hidden="true"
                                        >
                                            <strong>{product.name}</strong>
                                            {priceLabel ? (
                                                <span className="featured-collection-product-price">
                                                    {priceLabel}
                                                </span>
                                            ) : null}
                                        </span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <div className="featured-collection-empty" aria-hidden="true">
                        <span>{isZh ? '精选内容' : 'Curated selection'}</span>
                    </div>
                )}
            </div>
        </section>
    );
}

function ContentStorySection({
    block,
    language,
    onContentTarget,
}: {
    block: StorefrontContentBlock;
    language: StorefrontLanguage;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}) {
    const isZh = language === 'zh';
    const blockHasTarget = block.targetType !== 'NONE' && Boolean(block.targetValue);

    return (
        <section className="content-section content-story-section" aria-labelledby={`${block.id}-title`}>
            <article
                className="content-story-layout"
                style={{
                    backgroundColor: block.backgroundColor ?? undefined,
                    color: block.textColor ?? undefined,
                }}
            >
                <button
                    className="content-story-visual"
                    type="button"
                    disabled={!blockHasTarget}
                    onClick={() => onContentTarget(block.targetType, block.targetValue)}
                    aria-label={blockHasTarget ? block.ctaLabel || block.title : undefined}
                >
                    {block.imageUrl ? (
                        <SafeImage src={block.imageUrl} alt={block.title} imageKind="hero" loading="lazy" />
                    ) : (
                        <span className="content-story-placeholder" aria-hidden="true">
                            <span>STORY</span>
                            <Sparkles />
                        </span>
                    )}
                </button>
                <div className="content-story-copy">
                    <span className="content-story-kicker">
                        <span aria-hidden="true" />
                        {isZh ? '内容故事' : 'Editorial story'}
                    </span>
                    <h2 id={`${block.id}-title`}>{block.title}</h2>
                    {block.subtitle ? <p className="content-story-subtitle">{block.subtitle}</p> : null}
                    {block.body ? <p className="content-story-body">{block.body}</p> : null}
                    {blockHasTarget ? (
                        <button
                            className="content-story-action"
                            type="button"
                            onClick={() => onContentTarget(block.targetType, block.targetValue)}
                        >
                            <span>{block.ctaLabel || (isZh ? '继续阅读' : 'Read the story')}</span>
                            <ChevronRight aria-hidden="true" />
                        </button>
                    ) : null}
                </div>
            </article>
        </section>
    );
}

function ManagedSelectedProductButton({
    product,
    onContentTarget,
}: {
    product: Product;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}) {
    const imageUrl = productImage(product);
    return (
        <button
            className="managed-content-card is-product-media"
            type="button"
            onClick={() => onContentTarget('PRODUCT', product.id)}
        >
            <span className="managed-content-media" aria-hidden="true">
                {imageUrl ? (
                    <SafeImage src={imageUrl} alt="" imageKind="card" loading="lazy" />
                ) : (
                    <span className="managed-content-placeholder">
                        <LayoutGrid aria-hidden="true" />
                    </span>
                )}
            </span>
            <span className="managed-content-copy">
                <span>
                    <strong>{product.name}</strong>
                    {product.description ? <small>{trimText(product.description, 72)}</small> : null}
                </span>
                <ChevronRight aria-hidden="true" />
            </span>
        </button>
    );
}

function ManagedContentItemButton({
    item,
    products,
    onContentTarget,
}: {
    item: StorefrontContentItem;
    products: Product[];
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}) {
    const disabled = item.targetType === 'NONE' || !item.targetValue;
    const targetProduct =
        item.targetType === 'PRODUCT' ? products.find(product => product.id === item.targetValue) : undefined;
    const targetProductImage = productImage(targetProduct);
    return (
        <button
            className={`managed-content-card${targetProduct ? ' is-product-media' : ''}`}
            type="button"
            disabled={disabled}
            onClick={() => onContentTarget(item.targetType, item.targetValue)}
        >
            <span className="managed-content-media" aria-hidden="true">
                {item.imageUrl ? (
                    <SafeImage
                        src={item.imageUrl}
                        fallbackSrc={targetProductImage ?? undefined}
                        alt=""
                        imageKind="card"
                        loading="lazy"
                    />
                ) : targetProductImage ? (
                    <SafeImage src={targetProductImage} alt="" imageKind="card" loading="lazy" />
                ) : (
                    <span className="managed-content-placeholder">
                        <LayoutGrid aria-hidden="true" />
                    </span>
                )}
            </span>
            <span className="managed-content-copy">
                <span>
                    <strong>{item.label}</strong>
                    {item.description && <small>{item.description}</small>}
                </span>
                {!disabled && <ChevronRight aria-hidden="true" />}
            </span>
        </button>
    );
}
