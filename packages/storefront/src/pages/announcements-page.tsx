/* eslint-disable max-len -- Tailwind utility strings must remain intact for static extraction. */
import { ChevronRight, ExternalLink, Megaphone, WifiOff } from 'lucide-react';
import { useState } from 'react';

import { formatBusinessDate } from '../business-time';
import { PageSkeleton } from '../route-loading';
import { EmptyState, Sheet, Subpage } from '../storefront-ui/page-shell';
import { useStorefront } from '../StorefrontContext';
import { StorefrontLanguage, StorefrontSystemAnnouncement } from '../types';

interface AnnouncementsPageProps {
    announcements: StorefrontSystemAnnouncement[];
    loading: boolean;
    error: string;
    language: StorefrontLanguage;
    onBack: () => void;
    onRetry: () => void;
}

export function splitSystemAnnouncements(announcements: StorefrontSystemAnnouncement[]) {
    const [featured, ...more] = announcements;
    return { featured, more };
}

function shortAnnouncementDate(value: string | null): string | null {
    if (!value || Number.isNaN(new Date(value).getTime())) return null;
    return formatBusinessDate('en-US', value, { month: '2-digit', day: '2-digit' });
}

function announcementPeriod(
    announcement: StorefrontSystemAnnouncement,
    language: StorefrontLanguage,
): string {
    const isZh = language === 'zh';
    const startsAt = shortAnnouncementDate(announcement.startsAt);
    const endsAt = shortAnnouncementDate(announcement.endsAt);
    if (startsAt && endsAt) return `${startsAt} ${isZh ? '至' : '–'} ${endsAt}`;
    if (startsAt) return isZh ? `${startsAt} 起` : `From ${startsAt}`;
    if (endsAt) return isZh ? `有效至 ${endsAt}` : `Until ${endsAt}`;
    return isZh ? '长期有效' : 'Ongoing';
}

function announcementListDate(
    announcement: StorefrontSystemAnnouncement,
    language: StorefrontLanguage,
): string {
    return shortAnnouncementDate(announcement.startsAt) ?? (language === 'zh' ? '长期' : 'Open');
}

function announcementEndLabel(
    announcement: StorefrontSystemAnnouncement,
    language: StorefrontLanguage,
): string {
    const endsAt = shortAnnouncementDate(announcement.endsAt);
    if (!endsAt) return language === 'zh' ? '长期有效' : 'Ongoing';
    return language === 'zh' ? `有效至 ${endsAt}` : `Until ${endsAt}`;
}

export function AnnouncementDetailSheet({
    announcement,
    language,
    onClose,
}: {
    announcement: StorefrontSystemAnnouncement;
    language: StorefrontLanguage;
    onClose: () => void;
}) {
    const isZh = language === 'zh';
    const followLink = () => {
        if (!announcement.linkUrl) return;
        onClose();
        window.location.assign(announcement.linkUrl);
    };

    return (
        <Sheet
            title={announcement.title || (isZh ? '公告详情' : 'Notice details')}
            language={language}
            onClose={onClose}
        >
            <div className="notice-detail-content">
                <p className="mb-3 mt-0 text-xs font-medium text-slate-500">
                    {announcementPeriod(announcement, language)}
                </p>
                <p className="notice-detail-body">
                    {announcement.content.trim() ||
                        (isZh ? '此公告暂无更多内容。' : 'There are no additional details for this notice.')}
                </p>
                {announcement.linkUrl ? (
                    <div className="notice-detail-actions">
                        <button className="notice-detail-action" type="button" onClick={followLink}>
                            <span>{isZh ? '前往相关页面' : 'Open related page'}</span>
                            <ExternalLink aria-hidden="true" />
                        </button>
                    </div>
                ) : null}
            </div>
        </Sheet>
    );
}

export function AnnouncementsPage() {
    const { announcements, loading, error, language, onBack, onRetry } =
        useStorefront<AnnouncementsPageProps>();
    const isZh = language === 'zh';
    const [openAnnouncementId, setOpenAnnouncementId] = useState<string | null>(null);
    const { featured, more } = splitSystemAnnouncements(announcements);
    const openAnnouncement = announcements.find(announcement => announcement.id === openAnnouncementId);

    return (
        <Subpage title={isZh ? '网站公告' : 'Website notices'} language={language} onBack={onBack}>
            {loading && !announcements.length ? (
                <PageSkeleton label={isZh ? '正在加载网站公告' : 'Loading website notices'} />
            ) : error && !announcements.length ? (
                <EmptyState
                    icon={<WifiOff />}
                    title={isZh ? '网站公告加载失败' : 'Could not load website notices'}
                    detail={error}
                    action={isZh ? '重试' : 'Retry'}
                    onAction={onRetry}
                />
            ) : featured ? (
                <div className="pb-5">
                    <section className="px-4 pt-4" aria-labelledby="featured-announcement-title">
                        <button
                            className="w-full rounded-[14px] border border-orange-300 bg-[#fffaf3] px-4 py-4 text-left shadow-[0_4px_12px_rgba(15,23,42,0.06)] transition-colors hover:bg-orange-50 focus-visible:outline-orange-300"
                            type="button"
                            onClick={() => setOpenAnnouncementId(featured.id)}
                            aria-label={
                                isZh
                                    ? `查看重点公告：${featured.title}`
                                    : `Read featured notice: ${featured.title}`
                            }
                        >
                            <span className="grid grid-cols-[56px_minmax(0,1fr)_18px] items-start gap-3">
                                <span className="grid size-14 place-items-center rounded-xl bg-white text-orange-500 shadow-[0_1px_4px_rgba(15,23,42,0.04)] [&_svg]:size-7">
                                    <Megaphone aria-hidden="true" />
                                </span>
                                <span className="min-w-0">
                                    <strong
                                        id="featured-announcement-title"
                                        className="block overflow-hidden text-ellipsis whitespace-nowrap text-[17px] font-bold leading-[1.3] text-slate-900"
                                    >
                                        {featured.title}
                                    </strong>
                                    <span className="mt-2 flex flex-wrap items-center gap-2 text-xs font-medium text-orange-600">
                                        <span className="rounded-md border border-orange-200 bg-orange-50 px-2 py-1">
                                            {isZh ? '当前有效' : 'Active'}
                                        </span>
                                        <span>{announcementPeriod(featured, language)}</span>
                                    </span>
                                </span>
                                <ChevronRight
                                    className="mt-4 size-[18px] text-orange-500"
                                    aria-hidden="true"
                                />
                            </span>
                            <span className="mt-3 overflow-hidden text-[14px] leading-[1.65] text-slate-700 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                                {featured.content}
                            </span>
                        </button>
                    </section>

                    {more.length ? (
                        <section className="mt-5" aria-labelledby="more-announcements-title">
                            <header className="mb-2.5 flex items-center justify-between px-4">
                                <h2
                                    id="more-announcements-title"
                                    className="m-0 text-[17px] font-bold text-slate-900"
                                >
                                    {isZh ? '更多公告' : 'More notices'}
                                </h2>
                                <span className="text-sm font-medium text-slate-500">
                                    {isZh ? `${more.length} 条` : `${more.length} notices`}
                                </span>
                            </header>
                            <div className="mx-4 overflow-hidden rounded-[14px] border border-slate-200 bg-white">
                                {more.map((announcement, index) => (
                                    <button
                                        className={`grid min-h-[128px] w-full grid-cols-[64px_1px_minmax(0,1fr)_18px] items-center gap-3 bg-white px-3 py-4 text-left hover:bg-slate-50 ${index < more.length - 1 ? 'border-b border-slate-200' : 'border-0'}`}
                                        type="button"
                                        key={announcement.id}
                                        onClick={() => setOpenAnnouncementId(announcement.id)}
                                        aria-label={
                                            isZh
                                                ? `查看公告：${announcement.title}`
                                                : `Read notice: ${announcement.title}`
                                        }
                                    >
                                        <span className="text-center text-[15px] font-medium tabular-nums text-slate-500">
                                            {announcementListDate(announcement, language)}
                                        </span>
                                        <span className="h-full min-h-20 bg-slate-200" aria-hidden="true" />
                                        <span className="min-w-0">
                                            <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-semibold text-slate-900">
                                                {announcement.title}
                                            </strong>
                                            <span className="mt-2 overflow-hidden text-[13.5px] leading-[1.55] text-slate-600 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                                                {announcement.content}
                                            </span>
                                            <small className="mt-2 block text-xs font-medium text-slate-500">
                                                {announcementEndLabel(announcement, language)}
                                            </small>
                                        </span>
                                        <ChevronRight
                                            className="size-[18px] text-slate-400"
                                            aria-hidden="true"
                                        />
                                    </button>
                                ))}
                            </div>
                        </section>
                    ) : null}

                    <p className="mb-0 mt-5 text-center text-xs text-slate-400">
                        {isZh ? '公告内容由平台统一发布' : 'Notices are published by the platform'}
                    </p>
                </div>
            ) : (
                <EmptyState
                    icon={<Megaphone />}
                    title={isZh ? '暂无网站公告' : 'No website notices'}
                    detail={
                        isZh
                            ? '有新公告时会在这里和首页公告栏同步显示'
                            : 'New notices will appear here and in the home-page notice bar'
                    }
                    action={isZh ? '返回' : 'Back'}
                    onAction={onBack}
                />
            )}

            {openAnnouncement ? (
                <AnnouncementDetailSheet
                    announcement={openAnnouncement}
                    language={language}
                    onClose={() => setOpenAnnouncementId(null)}
                />
            ) : null}
        </Subpage>
    );
}
