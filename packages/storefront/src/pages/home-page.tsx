import { useNavigate } from '@tanstack/react-router';
import {
    Bell,
    Check,
    ChevronLeft,
    ChevronRight,
    CircleCheck,
    Download,
    ExternalLink,
    Headphones,
    LayoutGrid,
    Lock,
    RotateCcw,
    ShieldCheck,
    ShoppingBag,
    Sparkles,
    Tag,
    Truck,
    WifiOff,
    Zap,
} from 'lucide-react';
import {
    ReactNode,
    PointerEvent as ReactPointerEvent,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

import { normalizedHomepageVisualStyle } from '../../../storefront-content-plugin/src/content-visuals';
import { ContentText } from '../../../storefront-content-plugin/src/shared/content-text';
import { heroImageForViewport } from '../../../storefront-content-plugin/src/shared/hero-image';
import { HeroScene } from '../../../storefront-content-plugin/src/shared/hero-scene';
import { DesktopCouponTicket } from '../components/common/desktop-coupon-ticket';
import { MobilePageHeader } from '../components/common/mobile-page-header';
import { ProductCard, ProductCardSkeleton } from '../components/common/product-card';
import { claimableCouponCampaigns } from '../coupon-center-state';
import { useDesktopLayout, useDesktopViewport } from '../desktop-layout';
import {
    HERO_HEIGHT_TRANSITION_MS,
    HERO_TRANSITION_MS,
    heroDirectionBetweenSlides,
    heroIndexAfterManualMove,
    heroSwipeAxis,
    isCompletedHeroSwipe,
} from '../hero-carousel';
import { selectCategoryPromotionProducts, selectManagedProducts } from '../home-merchandising';
import { homepageModuleEntries } from '../homepage-module-order';
import { resolveManagedContentCopy } from '../managed-content-copy';
import { managedContentStyle } from '../managed-content-style';
import { PageSkeleton } from '../route-loading';
import { couponCardsFromCampaigns, StorefrontCouponCard } from '../storefront-coupons';
import { HomePageContext } from '../storefront-page-contexts';
import { storefrontPreviewParameters } from '../storefront-preview-parameters';
import { routeNavigateOptions, type RouteState } from '../storefront-router';
import {
    aggregateFlashSaleProducts,
    FlashSaleSection,
    HomeDualCategoryShowcase,
    ManagedAdCarousel,
    ManagedContentItemButton,
} from '../storefront-ui/content-ui';
import {
    EmptyState,
    InlineError,
    LegalFooter,
    SectionHeader,
    Sheet,
    Subpage,
    SubpageBody,
} from '../storefront-ui/page-shell';
import {
    contentNumberSetting,
    contentStringArraySetting,
    decodeStorefrontImage,
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
    StorefrontContentTargetType,
    StorefrontCouponCampaign,
    StorefrontFlashSale,
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
    const now = Date.now();
    const recentCutoff = now - 30 * 24 * 60 * 60 * 1000;
    const recentAnnouncements = systemAnnouncements
        .filter(announcement => {
            const publishedAt = announcement.startsAt ?? announcement.createdAt;
            if (!publishedAt) return true; // Older API responses keep their previous behavior during rollout.
            const time = Date.parse(publishedAt);
            return Number.isFinite(time) && time >= recentCutoff && time <= now;
        })
        .sort((left, right) => {
            const leftTime = Date.parse(left.startsAt ?? left.createdAt ?? '') || 0;
            const rightTime = Date.parse(right.startsAt ?? right.createdAt ?? '') || 0;
            return rightTime - leftTime;
        })
        .slice(0, 5);
    const systemNoticeItems = recentAnnouncements.flatMap(announcement => {
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
        return [...systemNoticeItems, ...managedNoticeItems].slice(0, 5);
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
    ].slice(0, 5);
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
                    <ContentText className="notice-detail-body">{item.content}</ContentText>
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
    const desktop = useDesktopLayout();
    const isZh = language === 'zh';
    const [claimingId, setClaimingId] = useState<string | null>(null);
    const handleClaim = async (coupon: StorefrontCouponCard) => {
        if (!coupon.claimable || claimingId) return;
        setClaimingId(coupon.id);
        const error = await onClaim(coupon.campaignId);
        setClaimingId(null);
        if (error) {
            if (onToast) onToast(error);
        } else {
            if (onToast) onToast(isZh ? '优惠券领取成功' : 'Coupon claimed successfully');
        }
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
                        const claimAction = (
                            <button
                                type="button"
                                className={`coupon-claim-btn ${!canClaim ? 'is-claimed' : ''}${claimingId === coupon.id ? ' is-claiming' : ''}`}
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
                                <span className="coupon-btn-text-wrap">
                                    {claimingId === coupon.id ? (
                                        <span>{isZh ? '领取中' : 'Claiming'}</span>
                                    ) : !canClaim ? (
                                        <>
                                            <span>{isZh ? '已领取' : 'Claimed'}</span>
                                            <Check size={12} strokeWidth={2.4} aria-hidden="true" />
                                        </>
                                    ) : (
                                        <span>{isZh ? '立即领取' : 'Claim'}</span>
                                    )}
                                </span>
                            </button>
                        );
                        if (desktop)
                            return (
                                <DesktopCouponTicket
                                    key={coupon.id}
                                    card={coupon}
                                    role="listitem"
                                    action={claimAction}
                                />
                            );

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
                                    <ContentText className="coupon-ticket-desc">
                                        {coupon.description}
                                    </ContentText>
                                </div>

                                <div className="coupon-ticket-action">{claimAction}</div>
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
    managedContentLoading?: boolean;
    heroAutoplayIntervalSeconds: number;
    configuredBlockTypes: Array<StorefrontContentBlock['type']>;
    coupons: StorefrontCouponCampaign[];
    couponCampaignsLoading: boolean;
    couponCampaignsError: string;
    flashSales: StorefrontFlashSale[];
    systemAnnouncements: StorefrontSystemAnnouncement[];
    bestSellerProducts: Product[];
    recommendationProducts: Product[];
    bestSellersLoading?: boolean;
    recommendationsLoading?: boolean;
    contentError: string;
    loading: boolean;
    error: string | null;
    catalogLoading: boolean;
    catalogError: string | null;
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

export function HomePage() {
    const navigate = useNavigate();
    const desktop = useDesktopLayout();
    const wideHeroViewport = useDesktopViewport('(min-width: 600px)');
    const wideHeroImage = desktop || wideHeroViewport;
    const navigateTo = (route: RouteState) => void navigate(routeNavigateOptions(route) as never);
    const {
        products,
        collections,
        contentBlocks,
        managedContentProducts,
        managedContentLoading = false,
        heroAutoplayIntervalSeconds,
        configuredBlockTypes,
        coupons,
        couponCampaignsLoading,
        couponCampaignsError,
        flashSales,
        systemAnnouncements,
        bestSellerProducts,
        recommendationProducts,
        bestSellersLoading = false,
        recommendationsLoading = false,
        contentError,
        loading,
        error,
        catalogLoading,
        catalogError,
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
        () =>
            contentBlocks.filter(
                block =>
                    block.type === 'HERO' && Boolean(heroImageForViewport(block, wideHeroImage).imageUrl),
            ),
        [contentBlocks, wideHeroImage],
    );
    const quickBlock = contentBlocks.find(block => block.type === 'QUICK_LINKS');
    const couponBlock = contentBlocks.find(block => block.type === 'COUPONS');
    const flashSaleBlock = contentBlocks.find(block => block.type === 'FLASH_SALE');
    const bestSellersBlock = contentBlocks.find(block => block.type === 'BEST_SELLERS');
    const recommendationsBlock = contentBlocks.find(block => block.type === 'RECOMMENDATIONS');
    const trustBlock = contentBlocks.find(block => block.type === 'TRUST_BAR');
    const coreCategoriesBlock = contentBlocks.find(
        block => block.type === 'CORE_CATEGORIES' && block.enabled && block.items.some(item => item.enabled),
    );
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
    const [readyHeroImage, setReadyHeroImage] = useState('');
    const [quickPage, setQuickPage] = useState(0);
    const [heroInteractionPaused, setHeroInteractionPaused] = useState(false);
    const [noticeIndex, setNoticeIndex] = useState(0);
    const [noticeHovered, setNoticeHovered] = useState(false);
    const [noticeFocused, setNoticeFocused] = useState(false);
    const [openNoticeId, setOpenNoticeId] = useState<string | null>(null);
    const [heroGestureActive, setHeroGestureActive] = useState(false);
    const [heroMotion, setHeroMotion] = useState<{
        nextIndex: number;
        direction: -1 | 1;
        offset: number;
        phase: 'dragging' | 'prepared' | 'settling';
        completed: boolean;
    } | null>(null);
    const heroMotionRef = useRef(heroMotion);
    const heroMotionTimerRef = useRef<number | null>(null);
    const heroMotionFrameRef = useRef<number | null>(null);
    const heroViewportRef = useRef<HTMLElement>(null);
    const heroStageRef = useRef<HTMLDivElement>(null);
    const [heroStageHeight, setHeroStageHeight] = useState<number>();
    const heroStageHeightRef = useRef<number | undefined>(undefined);
    const heroHeightGrowthDeadlineRef = useRef(0);
    const heroQueuedSelectionRef = useRef<{ index: number; direction?: -1 | 1 } | null>(null);
    const [heroAutoplayStopped, setHeroAutoplayStopped] = useState(false);
    useEffect(() => {
        const focusId = storefrontPreviewParameters().get('storefrontPreviewBlockId');
        if (!focusId) return;
        const index = managedHeroes.findIndex(block => block.id === focusId);
        if (index >= 0) {
            setHeroIndex(index);
            setHeroAutoplayStopped(true);
        }
    }, [managedHeroes]);
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
    const reducedMotionRef = useRef(prefersReducedMotion);
    reducedMotionRef.current = prefersReducedMotion;
    const [pageVisible, setPageVisible] = useState(true);
    const heroGestureRef = useRef({
        active: false,
        horizontal: false,
        suppressClick: false,
        startX: 0,
        startY: 0,
        pointerId: -1,
        width: 0,
    });
    const heroTransitionRef = useRef(0);
    const heroCount = managedHeroes.length;
    const managedHero = managedHeroes[heroIndex];
    const managedHeroProduct =
        managedHero?.targetType === 'PRODUCT'
            ? managedContentProductPool.find(product => product.id === managedHero.targetValue)
            : undefined;
    const hero = managedHeroProduct;
    const heroImage = heroImageForViewport(managedHero, wideHeroImage).imageUrl;
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
    const activeNoticeTitle = activeNoticeItem.title || (isZh ? '公告' : 'Notice');
    const activeNoticePreview = activeNoticeItem.content.replace(/\s+/gu, ' ').trim();
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
    const rawFlashSaleItems = flashSales
        .flatMap(sale => sale.items)
        .filter(
            (item, index, items) =>
                items.findIndex(candidate => candidate.productVariantId === item.productVariantId) === index,
        );
    const allFlashSaleProducts = aggregateFlashSaleProducts(rawFlashSaleItems);
    const configuredFlashSaleDisplayCount = flashSaleBlock?.settings?.displayCount;
    const flashSaleItems = allFlashSaleProducts.slice(
        0,
        configuredFlashSaleDisplayCount == null
            ? allFlashSaleProducts.length
            : Math.max(1, contentNumberSetting(configuredFlashSaleDisplayCount, allFlashSaleProducts.length)),
    );
    const noticeIntervalSeconds = Math.min(
        30,
        Math.max(3, contentNumberSetting(noticeBlock?.settings?.scrollIntervalSeconds, 5)),
    );

    const updateHeroMotion = useCallback((motion: typeof heroMotion) => {
        heroMotionRef.current = motion;
        setHeroMotion(motion);
    }, []);

    const clearHeroMotionSchedule = useCallback(() => {
        if (heroMotionTimerRef.current !== null) window.clearTimeout(heroMotionTimerRef.current);
        if (heroMotionFrameRef.current !== null) window.cancelAnimationFrame(heroMotionFrameRef.current);
        heroMotionTimerRef.current = null;
        heroMotionFrameRef.current = null;
    }, []);

    const settleHeroMotion = useCallback(
        (motion: NonNullable<typeof heroMotion>) => {
            clearHeroMotionSchedule();
            const finish = () => {
                heroMotionTimerRef.current = null;
                if (motion.completed) setHeroIndex(motion.nextIndex);
                updateHeroMotion(null);
            };
            if (reducedMotionRef.current) {
                finish();
                return;
            }
            updateHeroMotion({ ...motion, offset: 0, phase: 'settling' });
            heroMotionTimerRef.current = window.setTimeout(finish, HERO_TRANSITION_MS);
        },
        [clearHeroMotionSchedule, updateHeroMotion],
    );

    const showPreparedHero = useCallback(
        async (nextIndex: number, direction?: -1 | 1) => {
            const nextHero = managedHeroes[nextIndex];
            if (!nextHero || heroMotionRef.current?.phase === 'settling') return;
            const transitionId = ++heroTransitionRef.current;
            clearHeroMotionSchedule();
            if (nextIndex === heroIndex) return;
            const nextImage = heroImageForViewport(nextHero, wideHeroImage).imageUrl;
            try {
                await decodeStorefrontImage(nextImage, 'hero');
            } catch {
                // SafeImage shows an unavailable-image placeholder when the saved image fails.
            }
            if (heroTransitionRef.current !== transitionId) return;
            const dragging = heroMotionRef.current?.phase === 'dragging';
            const motion: NonNullable<typeof heroMotion> = {
                nextIndex,
                direction:
                    direction ?? heroDirectionBetweenSlides(heroIndex, nextIndex, managedHeroes.length),
                offset: dragging ? (heroMotionRef.current?.offset ?? 0) : 0,
                phase: 'prepared',
                completed: true,
            };
            if (reducedMotionRef.current) {
                settleHeroMotion(motion);
                return;
            }
            updateHeroMotion(motion);
            const start = (): void => {
                const remainingGrowth = Math.max(0, heroHeightGrowthDeadlineRef.current - performance.now());
                if (remainingGrowth > 0) {
                    heroMotionTimerRef.current = window.setTimeout(() => {
                        heroMotionTimerRef.current = null;
                        if (heroTransitionRef.current === transitionId) start();
                    }, remainingGrowth);
                } else {
                    settleHeroMotion(motion);
                }
            };
            if (dragging) {
                start();
                return;
            }
            // Paint both starting positions before applying their coordinated transition.
            heroMotionFrameRef.current = window.requestAnimationFrame(() => {
                heroMotionFrameRef.current = window.requestAnimationFrame(() => {
                    heroMotionFrameRef.current = null;
                    if (heroTransitionRef.current === transitionId) start();
                });
            });
        },
        [
            clearHeroMotionSchedule,
            wideHeroImage,
            heroIndex,
            managedHeroes,
            settleHeroMotion,
            updateHeroMotion,
        ],
    );

    useEffect(() => {
        ++heroTransitionRef.current;
        clearHeroMotionSchedule();
        heroGestureRef.current.active = false;
        heroGestureRef.current.horizontal = false;
        heroQueuedSelectionRef.current = null;
        const viewport = heroViewportRef.current;
        const pointerId = heroGestureRef.current.pointerId;
        if (pointerId >= 0 && viewport?.hasPointerCapture(pointerId))
            viewport.releasePointerCapture(pointerId);
        setHeroGestureActive(false);
        updateHeroMotion(null);
        setHeroIndex(index => (index < managedHeroes.length ? index : 0));
        return () => {
            ++heroTransitionRef.current;
            clearHeroMotionSchedule();
        };
    }, [managedHeroes, clearHeroMotionSchedule, updateHeroMotion]);

    useLayoutEffect(() => {
        const stage = heroStageRef.current;
        const viewport = heroViewportRef.current;
        if (!stage || !viewport) return;
        const copySurfaces = Array.from(stage.querySelectorAll<HTMLElement>('.hero-rich-content'));
        const gallery = desktop ? viewport.closest('.home-intro-grid')?.querySelector('.quick-grid') : null;
        const measure = () => {
            const minimum = Number.parseFloat(window.getComputedStyle(viewport).minHeight) || 0;
            const height = Math.ceil(
                Math.max(
                    minimum,
                    ...copySurfaces.map(copy => copy.getBoundingClientRect().height),
                    gallery?.getBoundingClientRect().height ?? 0,
                ),
            );
            if (height <= 0 || height === heroStageHeightRef.current) return;
            const previous = heroStageHeightRef.current ?? stage.getBoundingClientRect().height;
            heroStageHeightRef.current = height;
            // Make room for the taller copy before its final horizontal entrance.
            heroHeightGrowthDeadlineRef.current =
                height > previous && !reducedMotionRef.current
                    ? performance.now() + HERO_HEIGHT_TRANSITION_MS
                    : 0;
            setHeroStageHeight(height);
        };
        const observer = new ResizeObserver(measure);
        copySurfaces.forEach(copy => observer.observe(copy));
        observer.observe(viewport);
        if (gallery) observer.observe(gallery);
        window.addEventListener('resize', measure);
        measure();
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', measure);
        };
    }, [desktop, heroIndex, heroMotion?.nextIndex, managedHeroes]);

    useEffect(() => {
        const queued = heroQueuedSelectionRef.current;
        if (heroMotion || !queued) return;
        heroQueuedSelectionRef.current = null;
        void showPreparedHero(queued.index, queued.direction);
    }, [heroIndex, heroMotion, showPreparedHero]);

    useEffect(() => {
        const motion = heroMotionRef.current;
        if (!prefersReducedMotion || !motion || motion.phase === 'dragging') return;
        clearHeroMotionSchedule();
        if (motion.completed) setHeroIndex(motion.nextIndex);
        updateHeroMotion(null);
    }, [prefersReducedMotion, clearHeroMotionSchedule, updateHeroMotion]);

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
        if (
            noticeItems.length < 2 ||
            openNoticeId ||
            noticeHovered ||
            noticeFocused ||
            prefersReducedMotion ||
            !pageVisible
        ) {
            return;
        }
        const timer = window.setInterval(
            () => setNoticeIndex(index => (index + 1) % noticeItems.length),
            noticeIntervalSeconds * 1000,
        );
        return () => window.clearInterval(timer);
    }, [
        noticeIntervalSeconds,
        noticeItems.length,
        openNoticeId,
        noticeHovered,
        noticeFocused,
        pageVisible,
        prefersReducedMotion,
    ]);

    useEffect(() => {
        if (noticeIndex >= noticeItems.length) setNoticeIndex(0);
    }, [noticeIndex, noticeItems.length]);

    useEffect(() => {
        if (
            heroCount < 2 ||
            heroInteractionPaused ||
            heroGestureActive ||
            heroMotion ||
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
        heroMotion,
        heroIndex,
        heroInteractionPaused,
        pageVisible,
        prefersReducedMotion,
        showPreparedHero,
    ]);

    useEffect(() => {
        if (heroCount < 2 || readyHeroImage !== heroImage || !shouldPrefetchMedia()) return;
        const nextIndex = heroIndexAfterManualMove(heroIndex, heroCount, 1);
        const nextHero = managedHeroes[nextIndex];
        if (!nextHero) return;
        const nextImage = heroImageForViewport(nextHero, wideHeroImage).imageUrl;
        void decodeStorefrontImage(nextImage, 'hero').catch(() => undefined);
    }, [wideHeroImage, heroCount, heroImage, heroIndex, managedHeroes, readyHeroImage]);

    useEffect(() => {
        if (heroIndex >= heroCount) setHeroIndex(0);
    }, [heroCount, heroIndex]);

    const selectHeroManually = (index: number, direction?: -1 | 1) => {
        setHeroAutoplayStopped(true);
        if (heroMotionRef.current?.phase === 'settling' || heroMotionRef.current?.phase === 'prepared') {
            heroQueuedSelectionRef.current = { index, direction };
            return;
        }
        heroQueuedSelectionRef.current = null;
        void showPreparedHero(index, direction);
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
        if (
            heroCount < 2 ||
            event.button !== 0 ||
            event.isPrimary === false ||
            heroGestureRef.current.active ||
            heroMotionRef.current ||
            (interactiveTarget && !isHeroImageLink)
        ) {
            return;
        }
        ++heroTransitionRef.current;
        heroGestureRef.current = {
            active: true,
            horizontal: false,
            suppressClick: false,
            startX: event.clientX,
            startY: event.clientY,
            pointerId: event.pointerId,
            width: event.currentTarget.getBoundingClientRect().width,
        };
        setHeroGestureActive(true);
    };

    const moveHeroSwipe = (event: ReactPointerEvent<HTMLElement>) => {
        const gesture = heroGestureRef.current;
        if (!gesture.active || gesture.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - gesture.startX;
        const deltaY = event.clientY - gesture.startY;
        if (!gesture.horizontal) {
            const axis = heroSwipeAxis(deltaX, deltaY);
            if (axis === 'vertical') {
                gesture.active = false;
                setHeroGestureActive(false);
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }
                return;
            }
            if (axis !== 'horizontal') return;
            gesture.horizontal = true;
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        const direction = deltaX < 0 ? 1 : -1;
        updateHeroMotion({
            nextIndex: heroIndexAfterManualMove(heroIndex, heroCount, direction),
            direction,
            offset: Math.max(-gesture.width, Math.min(gesture.width, deltaX)),
            phase: 'dragging',
            completed: false,
        });
        event.preventDefault();
    };

    const finishHeroSwipe = (event: ReactPointerEvent<HTMLElement>, cancelled = false) => {
        const gesture = heroGestureRef.current;
        if ((!gesture.active && !gesture.horizontal) || gesture.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - gesture.startX;
        const deltaY = event.clientY - gesture.startY;
        const completed = !cancelled && gesture.horizontal && isCompletedHeroSwipe(deltaX, deltaY);
        const suppressClick = gesture.horizontal;
        gesture.active = false;
        gesture.horizontal = false;
        gesture.suppressClick = suppressClick;
        setHeroGestureActive(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (completed) {
            const direction = deltaX < 0 ? 1 : -1;
            selectHeroManually(heroIndexAfterManualMove(heroIndex, heroCount, direction), direction);
        } else if (heroMotionRef.current) {
            settleHeroMotion({ ...heroMotionRef.current, completed: false });
        }
        if (suppressClick) {
            window.setTimeout(() => {
                gesture.suppressClick = false;
            }, 0);
        }
    };

    useEffect(() => {
        const cancelGesture = () => {
            const gesture = heroGestureRef.current;
            gesture.active = false;
            gesture.horizontal = false;
            heroQueuedSelectionRef.current = null;
            const viewport = heroViewportRef.current;
            if (gesture.pointerId >= 0 && viewport?.hasPointerCapture(gesture.pointerId))
                viewport.releasePointerCapture(gesture.pointerId);
            ++heroTransitionRef.current;
            clearHeroMotionSchedule();
            updateHeroMotion(null);
            setHeroGestureActive(false);
        };
        if (!pageVisible) cancelGesture();
        window.addEventListener('blur', cancelGesture);
        return () => window.removeEventListener('blur', cancelGesture);
    }, [pageVisible, clearHeroMotionSchedule, updateHeroMotion]);

    const quickLinks: Array<{
        id: string;
        label: string;
        icon: ReactNode;
        imageUrl?: string | null;
        disabled?: boolean;
        onClick: () => void;
    }> = (quickBlock?.items ?? []).map((item, index) => ({
        id: item.id,
        label: item.label,
        icon: renderColorfulQuickIcon(item.label, index, desktop ? undefined : item.imageUrl),
        imageUrl: item.imageUrl?.trim(),
        disabled: item.targetType === 'NONE' || !item.targetValue,
        onClick: () => onContentTarget(item.targetType, item.targetValue),
    }));
    const quickPageCount = Math.max(1, Math.ceil(quickLinks.length / 5));
    const activeQuickPage = Math.min(quickPage, quickPageCount - 1);
    const visibleQuickLinks = desktop
        ? quickLinks.slice(activeQuickPage * 5, activeQuickPage * 5 + 5)
        : quickLinks;
    const desktopQuickRows =
        visibleQuickLinks.length > 3
            ? [visibleQuickLinks.slice(0, 2), visibleQuickLinks.slice(2)]
            : [visibleQuickLinks];
    const trustIcons = [ShieldCheck, Zap, Lock, Headphones];
    const trustItems = (trustBlock?.items ?? [])
        .filter(item => item.enabled && (item.label.trim() || item.description.trim()))
        .sort((first, second) => first.position - second.position)
        .map((item, index) => ({
            imageUrl: item.imageUrl,
            label: item.label,
            description: item.description,
            icon: trustIcons[index % trustIcons.length],
        }));
    const trustBarHasLongCopy = trustItems.some(
        ({ label }) => Array.from(label.trim()).length > (isZh ? 4 : 10),
    );
    const colorfulTrustBar = isColorfulHomepageStyle(trustBlock?.settings?.visualStyle);
    const colorfulQuickLinks = isColorfulHomepageStyle(quickBlock?.settings?.visualStyle);
    const trustBar =
        hasHomepageModule('TRUST_BAR') && trustItems.length > 0 ? (
            <div
                className={`home-trust-bar${trustBarHasLongCopy ? ' has-long-copy' : ''}${colorfulTrustBar ? ' is-color-marketplace' : ''}`}
                style={{ order: homepageModuleOrder('TRUST_BAR') }}
                aria-label={isZh ? '服务信息' : 'Service information'}
            >
                {trustItems.map((item, index) => {
                    const { label, description, icon: TrustIcon } = item;
                    const imageUrl = item.imageUrl;
                    return (
                        <div className="home-trust-item" key={`${label}-${index}`}>
                            {imageUrl ? (
                                <SafeImage
                                    src={imageUrl}
                                    alt=""
                                    imageKind="icon"
                                    className="trust-icon"
                                    sizes={desktop ? '28px' : '24px'}
                                />
                            ) : (
                                <TrustIcon className="trust-icon" aria-hidden="true" />
                            )}
                            {desktop ? (
                                <span className="home-trust-copy">
                                    <span className="home-trust-label">{label}</span>
                                    {description.trim() && (
                                        <small className="home-trust-description">{description}</small>
                                    )}
                                </span>
                            ) : (
                                <span className="home-trust-label">{label}</span>
                            )}
                        </div>
                    );
                })}
            </div>
        ) : null;
    const overlayTrustBar = hasHomepageModule('HERO') && heroCount > 0 && Boolean(trustBar);
    // All stores and viewports share the hero overlay. A standalone service
    // floor is only needed when the merchant has no published hero.
    const introOrders = (overlayTrustBar ? ['HERO', 'QUICK_LINKS'] : ['HERO', 'QUICK_LINKS', 'TRUST_BAR'])
        .map(type => homepageModuleOrder(type as StorefrontContentBlock['type']))
        .filter(order => order >= 0);
    const groupedIntro =
        desktop &&
        introOrders.length > 0 &&
        homepageModules
            .slice(Math.min(...introOrders), Math.max(...introOrders) + 1)
            .every(entry => ['HERO', 'QUICK_LINKS', 'TRUST_BAR'].includes(entry.type));

    return (
        <main className="page home-page" data-page-pending={loading ? 'query' : undefined}>
            <MobilePageHeader
                title={storefrontName}
                storefrontName={storefrontName}
                logoUrl={logoUrl}
                language={language}
                displayCurrencyCode={displayCurrencyCode}
                availableCurrencyCodes={
                    currencySelectorEnabled ? availableCurrencyCodes : [displayCurrencyCode]
                }
                currencyLoading={currencyLoading}
                onToggleLanguage={onToggleLanguage}
                onCurrencyChange={onCurrencyChange}
                onNotifications={onNotifications}
                onBrandClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            />

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
            {storefrontDescription && (
                <ContentText className="storefront-description">{storefrontDescription}</ContentText>
            )}

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
                <PageSkeleton variant="home" label={isZh ? '正在加载首页' : 'Loading home page'} />
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
                                        ? `查看公告全文：${activeNoticeTitle}`
                                        : `Read full notice: ${activeNoticeTitle}`
                                }
                                onClick={() => setOpenNoticeId(activeNoticeItem.id)}
                                onMouseEnter={() => setNoticeHovered(true)}
                                onMouseLeave={() => setNoticeHovered(false)}
                                onFocus={() => setNoticeFocused(true)}
                                onBlur={() => setNoticeFocused(false)}
                            >
                                <Bell aria-hidden="true" />
                                <span className="notice-strip-copy" key={activeNoticeItem.id}>
                                    <strong className="notice-strip-title">{activeNoticeTitle}</strong>
                                    {activeNoticePreview && (
                                        <span className="notice-strip-content">{activeNoticePreview}</span>
                                    )}
                                </span>
                                <ChevronRight aria-hidden="true" />
                            </button>
                        ) : null}
                        <div
                            className={`home-intro-grid${groupedIntro ? ' is-grouped-intro' : ''}`}
                            style={groupedIntro ? { order: Math.min(...introOrders) } : undefined}
                        >
                            {hasHomepageModule('HERO') && heroCount > 0 && (
                                <div
                                    className="hero-carousel"
                                    style={{ order: homepageModuleOrder('HERO') }}
                                    onMouseEnter={() => setHeroInteractionPaused(true)}
                                    onMouseLeave={() => setHeroInteractionPaused(false)}
                                    onFocus={() => setHeroInteractionPaused(true)}
                                    onBlur={event => {
                                        if (!event.currentTarget.contains(event.relatedTarget)) {
                                            setHeroInteractionPaused(false);
                                        }
                                    }}
                                >
                                    <section
                                        ref={heroViewportRef}
                                        className={[
                                            'hero hero-image-overlay',
                                            heroCount > 1 ? 'is-swipeable' : '',
                                            heroMotion?.phase === 'dragging' ? 'is-dragging' : '',
                                            overlayTrustBar ? 'has-service-overlay' : '',
                                            desktop && heroCount > 1 ? 'has-page-picker' : '',
                                        ]
                                            .filter(Boolean)
                                            .join(' ')}
                                        role="region"
                                        aria-label={managedHero?.title || (isZh ? '精选推荐' : 'Featured')}
                                        aria-roledescription={isZh ? '轮播' : 'carousel'}
                                        onPointerDown={beginHeroSwipe}
                                        onPointerMove={moveHeroSwipe}
                                        onPointerUp={event => finishHeroSwipe(event)}
                                        onPointerCancel={event => finishHeroSwipe(event, true)}
                                        onPointerLeave={event => {
                                            if (!heroGestureRef.current.horizontal)
                                                finishHeroSwipe(event, true);
                                        }}
                                        onLostPointerCapture={event => finishHeroSwipe(event, true)}
                                        onClickCapture={event => {
                                            if (!heroGestureRef.current.suppressClick) return;
                                            heroGestureRef.current.suppressClick = false;
                                            event.preventDefault();
                                            event.stopPropagation();
                                        }}
                                        onDragStart={event => event.preventDefault()}
                                        onKeyDown={event => {
                                            if (
                                                !desktop ||
                                                heroCount < 2 ||
                                                !['ArrowLeft', 'ArrowRight'].includes(event.key)
                                            )
                                                return;
                                            event.preventDefault();
                                            selectHeroManually(
                                                heroIndexAfterManualMove(
                                                    heroIndex,
                                                    heroCount,
                                                    event.key === 'ArrowLeft' ? -1 : 1,
                                                ),
                                                event.key === 'ArrowLeft' ? -1 : 1,
                                            );
                                        }}
                                    >
                                        <div
                                            ref={heroStageRef}
                                            className={`hero-carousel-stage${heroMotion?.phase === 'settling' ? ' is-settling' : ''}`}
                                            style={heroStageHeight ? { height: heroStageHeight } : undefined}
                                        >
                                            {[heroIndex, ...(heroMotion ? [heroMotion.nextIndex] : [])].map(
                                                (slideIndex, position) => {
                                                    const slide = managedHeroes[slideIndex];
                                                    if (!slide) return null;
                                                    const neighbor = position > 0;
                                                    const completing =
                                                        heroMotion?.phase === 'settling' &&
                                                        heroMotion.completed;
                                                    const offset = heroMotion?.offset ?? 0;
                                                    const direction = heroMotion?.direction ?? 1;
                                                    const translation = completing
                                                        ? `${neighbor ? 0 : -direction * 100}%`
                                                        : neighbor
                                                          ? `calc(${direction * 100}% + ${offset}px)`
                                                          : `${offset}px`;
                                                    const slideMedia = heroImageForViewport(
                                                        slide,
                                                        wideHeroImage,
                                                    );
                                                    const slideImage = slideMedia.imageUrl;
                                                    return (
                                                        <div
                                                            key={slide.id}
                                                            className={`hero-carousel-slide${neighbor ? ' is-neighbor' : ''}`}
                                                            style={{
                                                                transform: `translate3d(${translation}, 0, 0)`,
                                                            }}
                                                            aria-hidden={neighbor || undefined}
                                                            inert={neighbor || undefined}
                                                        >
                                                            <HeroScene
                                                                content={{ ...slide, imageUrl: slideImage }}
                                                                mediaOverlay={
                                                                    <div className="hero-overlay-controls">
                                                                        {overlayTrustBar && (
                                                                            <div className="hero-service-overlay">
                                                                                {trustBar}
                                                                            </div>
                                                                        )}
                                                                        {desktop && heroCount > 1 && (
                                                                            <div
                                                                                className="hero-page-picker"
                                                                                role="group"
                                                                                aria-label={
                                                                                    isZh
                                                                                        ? '选择轮播图片'
                                                                                        : 'Choose a slide'
                                                                                }
                                                                            >
                                                                                {managedHeroes.map(
                                                                                    (item, index) => (
                                                                                        <button
                                                                                            key={item.id}
                                                                                            type="button"
                                                                                            aria-label={
                                                                                                isZh
                                                                                                    ? `切换到第 ${index + 1} 张图片`
                                                                                                    : `Show slide ${index + 1}`
                                                                                            }
                                                                                            aria-current={
                                                                                                index ===
                                                                                                heroIndex
                                                                                                    ? 'true'
                                                                                                    : undefined
                                                                                            }
                                                                                            onClick={() =>
                                                                                                selectHeroManually(
                                                                                                    index,
                                                                                                )
                                                                                            }
                                                                                        >
                                                                                            <span className="hero-page-number">
                                                                                                {index + 1}
                                                                                            </span>
                                                                                        </button>
                                                                                    ),
                                                                                )}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                }
                                                                imageLabel={`${isZh ? '查看推荐内容' : 'Open featured content'}：${slide.title || storefrontName}`}
                                                                onImageOpen={handleHeroImageOpen}
                                                                onOpen={openActiveHero}
                                                                image={
                                                                    <SafeImage
                                                                        src={slideImage}
                                                                        alt={
                                                                            slide.title ||
                                                                            (isZh
                                                                                ? `${storefrontName}精选`
                                                                                : `${storefrontName} Featured`)
                                                                        }
                                                                        className="hero-rich-backdrop"
                                                                        imageKind="hero"
                                                                        width={
                                                                            slideMedia.imageAsset?.width ||
                                                                            undefined
                                                                        }
                                                                        height={
                                                                            slideMedia.imageAsset?.height ||
                                                                            undefined
                                                                        }
                                                                        loading="eager"
                                                                        fetchPriority={
                                                                            !neighbor && heroIndex === 0
                                                                                ? 'high'
                                                                                : 'auto'
                                                                        }
                                                                        onImageReady={() => {
                                                                            if (!neighbor)
                                                                                setReadyHeroImage(slideImage);
                                                                        }}
                                                                    />
                                                                }
                                                            />
                                                        </div>
                                                    );
                                                },
                                            )}
                                        </div>
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
                                </div>
                            )}

                            {!overlayTrustBar && trustBar}

                            {hasHomepageModule('QUICK_LINKS') && quickLinks.length > 0 ? (
                                <nav
                                    className={[
                                        'quick-grid',
                                        `quick-grid-${quickLinks.length}`,
                                        colorfulQuickLinks ? 'is-color-marketplace' : '',
                                        desktop ? 'is-desktop-gallery' : '',
                                    ]
                                        .filter(Boolean)
                                        .join(' ')}
                                    style={{ order: homepageModuleOrder('QUICK_LINKS') }}
                                    aria-label={
                                        desktop && quickBlock?.title
                                            ? quickBlock.title
                                            : isZh
                                              ? '快捷入口'
                                              : 'Quick links'
                                    }
                                >
                                    {desktop
                                        ? desktopQuickRows.map((row, rowIndex) => (
                                              <div
                                                  className="desktop-quick-row"
                                                  key={rowIndex}
                                                  style={{
                                                      gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`,
                                                  }}
                                              >
                                                  {row.map(item => (
                                                      <button
                                                          type="button"
                                                          className="desktop-quick-tile"
                                                          key={item.id}
                                                          onClick={item.onClick}
                                                          disabled={item.disabled}
                                                      >
                                                          <span
                                                              className="desktop-quick-media"
                                                              aria-hidden="true"
                                                          >
                                                              {item.imageUrl ? (
                                                                  <SafeImage
                                                                      src={item.imageUrl}
                                                                      alt=""
                                                                      imageKind="card"
                                                                      sizes="(min-width: 1400px) 210px, 20vw"
                                                                  />
                                                              ) : (
                                                                  item.icon
                                                              )}
                                                          </span>
                                                          <b>{item.label}</b>
                                                      </button>
                                                  ))}
                                              </div>
                                          ))
                                        : visibleQuickLinks.map(item => (
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
                                    {desktop && quickPageCount > 1 && (
                                        <div className="desktop-quick-pagination">
                                            <button
                                                type="button"
                                                aria-label={isZh ? '上一组快捷入口' : 'Previous shortcuts'}
                                                onClick={() =>
                                                    setQuickPage(
                                                        (activeQuickPage - 1 + quickPageCount) %
                                                            quickPageCount,
                                                    )
                                                }
                                            >
                                                <ChevronLeft aria-hidden="true" />
                                            </button>
                                            <span aria-live="polite">
                                                {activeQuickPage + 1} / {quickPageCount}
                                            </span>
                                            <button
                                                type="button"
                                                aria-label={isZh ? '下一组快捷入口' : 'Next shortcuts'}
                                                onClick={() =>
                                                    setQuickPage((activeQuickPage + 1) % quickPageCount)
                                                }
                                            >
                                                <ChevronRight aria-hidden="true" />
                                            </button>
                                        </div>
                                    )}
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
                                    loading={managedContentLoading}
                                    language={language}
                                    locale={locale}
                                    market={market}
                                    onContentTarget={onContentTarget}
                                />
                            </div>
                        ))}

                        {!products.length &&
                        !bestSellersLoading &&
                        !recommendationsLoading &&
                        !bestSellerProducts.length &&
                        !recommendationProducts.length ? (
                            <div
                                className={homepageSectionShellClassName}
                                style={{ order: homepageModules.length }}
                            >
                                {catalogLoading ? (
                                    <PageSkeleton
                                        variant="catalog"
                                        label={isZh ? '正在加载商品' : 'Loading products'}
                                    />
                                ) : catalogError ? (
                                    <EmptyState
                                        icon={<WifiOff />}
                                        title={isZh ? '商品暂时无法加载' : 'Products are unavailable'}
                                        detail={catalogError}
                                        action={isZh ? '重试' : 'Try again'}
                                        onAction={onRetry}
                                    />
                                ) : (
                                    <EmptyState
                                        icon={<ShoppingBag />}
                                        title={isZh ? '暂无在售商品' : 'No products are available'}
                                        detail={
                                            isZh
                                                ? '商家在管理后台上架商品后会显示在这里'
                                                : 'Products will appear here after the merchant publishes them'
                                        }
                                    />
                                )}
                            </div>
                        ) : null}

                        {hasHomepageModule('FLASH_SALE') && flashSaleItems.length ? (
                            <div
                                className={homepageSectionShellClassName}
                                style={{ order: homepageModuleOrder('FLASH_SALE') }}
                            >
                                <FlashSaleSection
                                    title={flashSaleBlock?.title || (isZh ? '限时秒杀' : 'Flash sale')}
                                    items={flashSaleItems}
                                    locale={locale}
                                    language={language}
                                    endsAt={flashSales[0]?.endsAt ?? null}
                                    onMore={() => navigateTo({ name: 'flash-sale' })}
                                    onProduct={(productId, variantId) =>
                                        navigateTo({ name: 'product', id: productId, variantId })
                                    }
                                />
                            </div>
                        ) : null}

                        {hasHomepageModule('BEST_SELLERS') &&
                        (bestSellersLoading || bestSellerProducts.length) ? (
                            <div
                                className={homepageSectionShellClassName}
                                style={{ order: homepageModuleOrder('BEST_SELLERS') }}
                            >
                                <ProductSection
                                    kind="best-sellers"
                                    prioritizeFirstImage={false}
                                    title={bestSellersTitle}
                                    subtitle={bestSellersBlock?.subtitle}
                                    action={isZh ? '更多' : 'More'}
                                    onAction={() => navigateTo({ name: 'category', sort: 'sales' })}
                                    products={bestSellerProducts}
                                    loading={bestSellersLoading}
                                    skeletonCount={Math.min(
                                        50,
                                        Math.max(
                                            1,
                                            contentNumberSetting(bestSellersBlock?.settings?.displayCount, 4),
                                        ),
                                    )}
                                    market={market}
                                    locale={locale}
                                    language={language}
                                    onProduct={product => navigateTo({ name: 'product', id: product.id })}
                                />
                            </div>
                        ) : null}

                        {hasHomepageModule('RECOMMENDATIONS') &&
                        (recommendationsLoading || recommendationProducts.length) ? (
                            <div
                                className={homepageSectionShellClassName}
                                style={{ order: homepageModuleOrder('RECOMMENDATIONS') }}
                            >
                                <ProductSection
                                    kind="recommendations"
                                    prioritizeFirstImage={false}
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
                                    loading={recommendationsLoading}
                                    skeletonCount={Math.min(
                                        50,
                                        Math.max(
                                            1,
                                            contentNumberSetting(
                                                recommendationsBlock?.settings?.displayCount,
                                                6,
                                            ),
                                        ),
                                    )}
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
        </main>
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
            <SubpageBody>
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
            </SubpageBody>
        </Subpage>
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
    loading = false,
    language,
    locale,
    market,
    onContentTarget,
}: {
    block: StorefrontContentBlock;
    products: Product[];
    loading?: boolean;
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
                loading={loading}
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
                products={selectedProducts}
                market={market}
                language={language}
                locale={locale}
                onContentTarget={onContentTarget}
            />
        );
    }
    if (block.type === 'STORY') {
        return <ContentStorySection block={block} language={language} onContentTarget={onContentTarget} />;
    }
    if (block.type === 'CUSTOM' && !block.imageUrl && !block.body && !block.items.length && !blockHasTarget) {
        return (
            <ProductSection
                title={block.title}
                prioritizeFirstImage={false}
                subtitle={block.subtitle}
                products={selectedProducts}
                market={market}
                locale={locale}
                language={language}
                onProduct={product => onContentTarget('PRODUCT', product.id)}
            />
        );
    }
    return (
        <section
            className={`content-section managed-content-section managed-content-${block.type.toLowerCase()}`}
            style={{
                ...managedContentStyle(block),
            }}
        >
            <SectionHeader
                title={block.title}
                subtitle={block.subtitle}
                subtitlePlacement={
                    block.type === 'CUSTOM' && block.settings?.displayMode === 'scrollingAds'
                        ? 'end'
                        : 'below'
                }
                action={blockHasTarget ? block.ctaLabel || undefined : undefined}
                onAction={
                    blockHasTarget ? () => onContentTarget(block.targetType, block.targetValue) : undefined
                }
            />
            {block.body && <ContentText className="managed-content-body">{block.body}</ContentText>}
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
            {block.type === 'CUSTOM' &&
            block.settings?.displayMode === 'scrollingAds' &&
            block.items.length ? (
                <ManagedAdCarousel
                    block={block}
                    products={products}
                    language={language}
                    onContentTarget={onContentTarget}
                />
            ) : (
                !!(block.items.length || additionalSelectedProducts.length) && (
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
                )
            )}
        </section>
    );
}

function CategoryPromotionSection({
    block,
    products,
    loading = false,
    language,
    locale,
    market,
    onContentTarget,
}: {
    block: StorefrontContentBlock;
    products: Product[];
    loading?: boolean;
    language: StorefrontLanguage;
    locale: string;
    market: MarketConfig;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}) {
    const isZh = language === 'zh';
    const desktop = useDesktopLayout();
    const productRailRef = useRef<HTMLDivElement>(null);
    const [scrollbarHeight, setScrollbarHeight] = useState(0);
    const blockHasTarget = block.targetType !== 'NONE' && Boolean(block.targetValue);
    const displayCount = Math.min(4, Math.max(1, contentNumberSetting(block.settings?.displayCount, 4)));
    const categoryProducts = selectCategoryPromotionProducts({
        selectedProductIds: contentStringArraySetting(block.settings?.selectedProductIds),
        products,
        targetType: block.targetType,
        targetValue: block.targetValue,
        count: displayCount,
    });
    const selectedCount = new Set(contentStringArraySetting(block.settings?.selectedProductIds)).size;
    const pendingProducts = loading && selectedCount > 0;
    const productGridCount = pendingProducts
        ? Math.min(displayCount, selectedCount)
        : Math.max(1, Math.min(4, categoryProducts.length));
    const hasSupportingContent = pendingProducts || categoryProducts.length > 0 || block.items.length > 0;
    const colorfulMarketplace = isColorfulHomepageStyle(block.settings?.visualStyle);
    const sectionClassName = `content-section managed-content-section managed-content-category_ad category-promotion-section${
        colorfulMarketplace ? ' is-color-marketplace' : ''
    }`;

    useLayoutEffect(() => {
        const rail = productRailRef.current;
        if (!desktop || !rail) {
            setScrollbarHeight(0);
            return;
        }
        // Align the artwork with the cards, excluding any native scrollbar below them.
        const measure = () => setScrollbarHeight(Math.max(0, rail.offsetHeight - rail.clientHeight));
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(rail);
        return () => observer.disconnect();
    }, [desktop, categoryProducts.length, pendingProducts]);

    return (
        <section
            className={sectionClassName}
            style={{
                ...managedContentStyle(block),
            }}
        >
            <SectionHeader
                kind="categories"
                title={block.title}
                subtitle={block.subtitle}
                subtitlePlacement="end"
            />
            <div className={`category-promotion-layout${hasSupportingContent ? '' : ' is-visual-only'}`}>
                <button
                    className="category-promotion-visual"
                    style={desktop ? { marginBottom: scrollbarHeight } : undefined}
                    type="button"
                    disabled={!blockHasTarget}
                    onClick={() => onContentTarget(block.targetType, block.targetValue)}
                    aria-label={
                        blockHasTarget ? (isZh ? `打开${block.title}` : `Open ${block.title}`) : block.title
                    }
                >
                    {block.imageUrl ? (
                        <SafeImage
                            src={block.imageUrl}
                            alt={block.title}
                            imageKind="hero"
                            loading="lazy"
                            width={block.imageAsset?.width || undefined}
                            height={block.imageAsset?.height || undefined}
                        />
                    ) : (
                        <span className="category-promotion-placeholder" aria-hidden="true">
                            <LayoutGrid />
                        </span>
                    )}
                    <span className="category-promotion-visual-copy" aria-hidden="true">
                        <small>{isZh ? '查看精选' : 'Explore selection'}</small>
                    </span>
                </button>

                {pendingProducts || categoryProducts.length ? (
                    <div
                        ref={productRailRef}
                        aria-busy={pendingProducts || undefined}
                        data-page-pending={pendingProducts ? 'data' : undefined}
                        className={`product-grid category-promotion-products category-promotion-products-${productGridCount} desktop-product-rail is-four-column`}
                    >
                        {pendingProducts
                            ? Array.from({ length: productGridCount }, (_, index) => (
                                  <ProductCardSkeleton key={index} />
                              ))
                            : categoryProducts.map(product => (
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
    const [featuredProduct, ...supportingProducts] = products;

    return (
        <section
            className="content-section featured-collection-section"
            aria-labelledby={`${block.id}-title`}
        >
            <div className="featured-collection-layout">
                <div
                    className="featured-collection-intro"
                    style={{
                        ...managedContentStyle(block),
                    }}
                >
                    <h2 id={`${block.id}-title`}>{block.title}</h2>
                    {block.subtitle ? (
                        <ContentText className="featured-collection-subtitle">{block.subtitle}</ContentText>
                    ) : null}
                    {block.body ? (
                        <ContentText className="featured-collection-body">{block.body}</ContentText>
                    ) : null}
                    {blockHasTarget ? (
                        <button
                            className="featured-collection-action"
                            type="button"
                            onClick={() => onContentTarget(block.targetType, block.targetValue)}
                        >
                            <span className="featured-collection-action-label">
                                {block.ctaLabel || (isZh ? '浏览全部' : 'View collection')}
                                <ChevronRight aria-hidden="true" />
                            </span>
                        </button>
                    ) : null}
                </div>
                {featuredProduct ? (
                    <div
                        className="featured-collection-mosaic"
                        data-product-count={products.length}
                        aria-label={block.title}
                    >
                        <ProductCard
                            key={featuredProduct.id}
                            product={featuredProduct}
                            market={market}
                            locale={locale}
                            language={language}
                            appearance="mosaic"
                            imageSizes="(min-width: 1280px) 600px, 45vw"
                            onOpen={() => onContentTarget('PRODUCT', featuredProduct.id)}
                        />
                        {supportingProducts.length > 0 && (
                            <div
                                className="featured-collection-supporting-products"
                                data-product-count={supportingProducts.length}
                            >
                                {supportingProducts.map(product => (
                                    <ProductCard
                                        key={product.id}
                                        product={product}
                                        market={market}
                                        locale={locale}
                                        language={language}
                                        appearance="gallery"
                                        imageSizes="(min-width: 1280px) 240px, (min-width: 768px) 20vw, 28vw"
                                        onOpen={() => onContentTarget('PRODUCT', product.id)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="featured-collection-empty">
                        <span>{isZh ? '精选商品即将上架' : 'New selections coming soon'}</span>
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
                    ...managedContentStyle(block),
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
                        <SafeImage
                            src={block.imageUrl}
                            alt={block.title}
                            imageKind="hero"
                            loading="lazy"
                            width={block.imageAsset?.width || undefined}
                            height={block.imageAsset?.height || undefined}
                        />
                    ) : (
                        <span className="content-story-placeholder" aria-hidden="true">
                            <span>STORY</span>
                            <Sparkles />
                        </span>
                    )}
                </button>
                <div className="content-story-copy">
                    <ContentText className="content-story-kicker">
                        {block.subtitle || (isZh ? '内容故事' : 'Editorial story')}
                    </ContentText>
                    <h2 id={`${block.id}-title`}>{block.title}</h2>
                    {block.body ? (
                        <ContentText className="content-story-body">{block.body}</ContentText>
                    ) : null}
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
