// organize-imports-ignore -- Preserve ESLint type groups.
import type { ShopApi } from '../api';
import type { RouteState } from '../storefront-router';
import type {
    MarketConfig,
    StorefrontContentTargetType,
    StorefrontLanguage,
    StorefrontSystemAnnouncement,
} from '../types';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ExternalLink, Megaphone } from 'lucide-react';

import { ContentText } from '../../../storefront-content-plugin/src/shared/content-text';
import { formatBusinessDate } from '../business-time';
import { PageBackButton } from '../components/common/page-back-button';
import { languageCodeFor } from '../i18n';
import { resolveQueryLoadState, storefrontInitialQueryError } from '../loading-state';
import { usePageReadiness } from '../page-readiness';
import { PUBLIC_QUERY_GC_TIME, PUBLIC_QUERY_STALE_TIME, storefrontQueryKeys } from '../query-client';
import { AsyncRouteStatePage, EmptyState, Subpage, SubpageBody } from '../storefront-ui/page-shell';

import '../styles/announcements.css';
import '../styles/notifications.css';

export const ANNOUNCEMENTS_PAGE_SIZE = 12;

export interface AnnouncementsPageProps {
    api: Pick<ShopApi, 'contentReviewsApi'>;
    market: MarketConfig;
    language: StorefrontLanguage;
    locale: string;
    route: RouteState;
    onBack: () => void;
    onNavigate: (route: RouteState, replace?: boolean) => void;
    onContentTarget: (type: StorefrontContentTargetType, value: string | null) => void;
}

function AnnouncementDate({ item, locale }: { item: StorefrontSystemAnnouncement; locale: string }) {
    const date = item.startsAt ?? item.createdAt;
    if (!date || !Number.isFinite(Date.parse(date))) return null;
    return (
        <time dateTime={date}>
            {formatBusinessDate(locale, date, { year: 'numeric', month: 'short', day: 'numeric' })}
        </time>
    );
}

export function AnnouncementsPage({
    api,
    market,
    language,
    locale,
    route,
    onBack,
    onNavigate,
    onContentTarget,
}: AnnouncementsPageProps) {
    const isZh = language === 'zh';
    const page = route.page ?? 1;
    const id = route.id;
    const scope = storefrontQueryKeys.market(market);
    const languageCode = languageCodeFor(language);
    const listQuery = useQuery({
        queryKey: storefrontQueryKeys.announcements(scope, languageCode, page, ANNOUNCEMENTS_PAGE_SIZE),
        queryFn: ({ signal }) =>
            api.contentReviewsApi.announcements(
                { skip: (page - 1) * ANNOUNCEMENTS_PAGE_SIZE, take: ANNOUNCEMENTS_PAGE_SIZE },
                signal,
            ),
        enabled: !id,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const detailQuery = useQuery({
        queryKey: storefrontQueryKeys.announcement(scope, languageCode, id ?? ''),
        queryFn: ({ signal }) => {
            if (!id) throw new Error('Announcement id is required');
            return api.contentReviewsApi.announcement(id, signal);
        },
        enabled: Boolean(id),
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const activeQuery = id ? detailQuery : listQuery;
    const state = resolveQueryLoadState({
        hasData: activeQuery.data !== undefined,
        isLoading: activeQuery.isPending,
        isPaused: activeQuery.isPaused,
        isError: activeQuery.isError,
    });
    usePageReadiness(state === 'loading');
    const showList = (targetPage = page) =>
        onNavigate({ name: 'announcements', page: targetPage > 1 ? targetPage : undefined });
    const back = id ? () => showList() : onBack;
    if (state !== 'ready')
        return (
            <AsyncRouteStatePage
                routeName="announcements"
                state={state}
                language={language}
                error={storefrontInitialQueryError(activeQuery, language)}
                onBack={back}
                onRetry={() => void activeQuery.refetch({ cancelRefetch: false })}
            />
        );

    const total = listQuery.data?.totalItems ?? 0;
    const pages = Math.max(1, Math.ceil(total / ANNOUNCEMENTS_PAGE_SIZE));
    const detail = detailQuery.data;
    return (
        <Subpage
            title={id ? (isZh ? '公告详情' : 'Announcement details') : isZh ? '系统公告' : 'Announcements'}
            language={language}
            onBack={back}
            className="announcements-page"
        >
            <SubpageBody>
                {id ? (
                    <div className="hidden lg:block">
                        <PageBackButton
                            label={isZh ? '返回全部公告' : 'Back to announcements'}
                            onClick={back}
                        >
                            {isZh ? '返回全部公告' : 'Back to announcements'}
                        </PageBackButton>
                    </div>
                ) : null}
                {id ? (
                    detail ? (
                        <article className="announcement-article">
                            <header>
                                <span className="announcement-category type-helper">
                                    <Megaphone aria-hidden="true" />
                                    {isZh ? '系统公告' : 'Announcement'}
                                </span>
                                <h1 className="type-page">
                                    {detail.title || (isZh ? '公告详情' : 'Announcement details')}
                                </h1>
                                <div className="type-meta announcement-date">
                                    <AnnouncementDate item={detail} locale={locale} />
                                </div>
                            </header>
                            <ContentText as="div" className="announcement-body type-reading">
                                {detail.content ||
                                    (isZh
                                        ? '此公告暂无更多内容。'
                                        : 'There are no additional details for this announcement.')}
                            </ContentText>
                            {detail.linkUrl ? (
                                <button
                                    type="button"
                                    className="primary-action"
                                    onClick={() => onContentTarget('URL', detail.linkUrl)}
                                >
                                    {isZh ? '前往相关页面' : 'Open related page'}
                                    <ExternalLink aria-hidden="true" />
                                </button>
                            ) : null}
                        </article>
                    ) : (
                        <EmptyState
                            icon={<Megaphone />}
                            title={isZh ? '此公告暂不可查看' : 'Announcement unavailable'}
                            detail={
                                isZh
                                    ? '公告可能已下架、已过期，或当前语言暂未提供。'
                                    : 'It may have been removed, expired, or be unavailable in this language.'
                            }
                            action={isZh ? '返回全部公告' : 'View all announcements'}
                            onAction={() => showList()}
                        />
                    )
                ) : (
                    <section
                        className="notification-workbench"
                        aria-label={isZh ? '全部公告' : 'All announcements'}
                    >
                        <header className="announcement-list-heading">
                            <h2 className="type-section">{isZh ? '全部公告' : 'All announcements'}</h2>
                            <span className="type-meta">
                                {isZh ? `共 ${total} 条` : `${total} announcements`}
                            </span>
                        </header>
                        {listQuery.data?.items.length ? (
                            <div className="notification-list">
                                {listQuery.data.items.map(item => (
                                    <button
                                        type="button"
                                        key={item.id}
                                        onClick={() =>
                                            onNavigate({
                                                name: 'announcements',
                                                id: item.id,
                                                page: page > 1 ? page : undefined,
                                            })
                                        }
                                    >
                                        <span className="notification-icon">
                                            <Megaphone aria-hidden="true" />
                                        </span>
                                        <span className="notification-content">
                                            <strong>
                                                {item.title || (isZh ? '公告详情' : 'Announcement details')}
                                            </strong>
                                            <small>{item.content}</small>
                                        </span>
                                        <span className="notification-time">
                                            <AnnouncementDate item={item} locale={locale} />
                                        </span>
                                        <ChevronRight aria-hidden="true" />
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <EmptyState
                                icon={<Megaphone />}
                                title={
                                    page > 1
                                        ? isZh
                                            ? '本页暂无公告'
                                            : 'No announcements on this page'
                                        : isZh
                                          ? '暂无系统公告'
                                          : 'No announcements yet'
                                }
                                detail={
                                    page > 1
                                        ? isZh
                                            ? '公告列表已更新，请返回第一页查看。'
                                            : 'The list has changed. Return to the first page.'
                                        : isZh
                                          ? '店铺发布的系统公告将在这里展示。'
                                          : 'Published announcements from this store will appear here.'
                                }
                                action={page > 1 ? (isZh ? '返回第一页' : 'Go to first page') : undefined}
                                onAction={page > 1 ? () => showList(1) : undefined}
                            />
                        )}
                        {pages > 1 || page > 1 ? (
                            <nav
                                className="notification-toolbar announcement-pagination"
                                aria-label={isZh ? '公告分页' : 'Announcement pages'}
                            >
                                <button type="button" disabled={page <= 1} onClick={() => showList(page - 1)}>
                                    <ChevronLeft aria-hidden="true" />
                                    {isZh ? '上一页' : 'Previous'}
                                </button>
                                <span className="type-helper" aria-live="polite">
                                    {isZh ? `第 ${page} 页 / 共 ${pages} 页` : `Page ${page} of ${pages}`}
                                </span>
                                <button
                                    type="button"
                                    disabled={page >= pages}
                                    onClick={() => showList(page + 1)}
                                >
                                    {isZh ? '下一页' : 'Next'}
                                    <ChevronRight aria-hidden="true" />
                                </button>
                            </nav>
                        ) : null}
                    </section>
                )}
            </SubpageBody>
        </Subpage>
    );
}
