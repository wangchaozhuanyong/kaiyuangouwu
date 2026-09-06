/* eslint-disable max-len -- Tailwind utility strings must remain intact for static extraction. */
import { useQuery } from '@tanstack/react-query';
import {
    Check,
    ChevronLeft,
    ChevronRight,
    Copy,
    Gift,
    Image,
    Info,
    Share2,
    ShoppingBag,
    Users,
    WalletCards,
} from 'lucide-react';
import { useMemo, useState } from 'react';

const REFERRAL_LIST_PAGE_SIZE = 10;

import { ShopApi } from '../api';
import { languageCodeFor } from '../i18n';
import { PUBLIC_QUERY_GC_TIME, ROUTE_QUERY_STALE_TIME, storefrontQueryKeys } from '../query-client';
import { referralShareUrl } from '../referral-attribution';
import { availablePosterTemplates } from '../referral-poster-layout';
import { ReferralPosterModal } from '../referral-poster-modal';
import { PageSkeleton } from '../route-loading';
import { ReferralPageContext } from '../storefront-page-contexts';
import { EmptyState, Subpage } from '../storefront-ui/page-shell';
import { formatMoney } from '../storefront-ui/product-display';
import { ActiveCustomer, MarketConfig, ReferralLedgerEntry, StorefrontLanguage } from '../types';

export interface ReferralPageProps {
    api: ShopApi;
    customer: ActiveCustomer | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    storefrontName: string;
    logoUrl: string | null;
    onBack: () => void;
    onNotify: (message: string) => void;
    onLogin: () => void;
}

export function ReferralPage() {
    const { api, customer, market, locale, language, storefrontName, logoUrl, onBack, onNotify, onLogin } =
        ReferralPageContext.useValue();
    const isZh = language === 'zh';
    const [copied, setCopied] = useState(false);
    const [showPoster, setShowPoster] = useState(false);
    const programQuery = useQuery({
        queryKey: storefrontQueryKeys.referralProgram(
            storefrontQueryKeys.market(market),
            languageCodeFor(language),
        ),
        queryFn: ({ signal }) => api.referralProgram(signal),
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const overviewQuery = useQuery({
        queryKey: storefrontQueryKeys.customerReferral(
            storefrontQueryKeys.market(market),
            languageCodeFor(language),
            customer?.id ?? '',
        ),
        queryFn: ({ signal }) => api.myReferralOverview(signal),
        enabled: Boolean(customer && programQuery.data?.enabled),
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const hasPosterTemplates = Boolean(
        programQuery.data &&
        availablePosterTemplates(
            programQuery.data.posterTemplates,
            programQuery.data.systemPosterTemplateConfigs ?? [],
            programQuery.data.posterTemplateConfigs ?? [],
        ).length,
    );
    const overview = overviewQuery.data;
    const wallet = overview?.wallets.find(item => item.currencyCode === market.currencyCode);
    const rewardSummary = overview?.rewardSummaries.find(item => item.currencyCode === market.currencyCode);
    const shareUrl = overview ? referralShareUrl(overview.inviteCode) : '';
    const displayLedger = useMemo(
        () => overview?.ledger.filter(entry => entry.currencyCode === market.currencyCode) ?? [],
        [market.currencyCode, overview?.ledger],
    );
    const [inviteePage, setInviteePage] = useState(1);
    const [ledgerPage, setLedgerPage] = useState(1);

    const invitees = useMemo(() => overview?.invitees ?? [], [overview?.invitees]);
    const inviteeTotalPages = Math.max(1, Math.ceil(invitees.length / REFERRAL_LIST_PAGE_SIZE));
    const safeInviteePage = Math.min(Math.max(1, inviteePage), inviteeTotalPages);
    const paginatedInvitees = useMemo(() => {
        const start = (safeInviteePage - 1) * REFERRAL_LIST_PAGE_SIZE;
        return invitees.slice(start, start + REFERRAL_LIST_PAGE_SIZE);
    }, [invitees, safeInviteePage]);

    const ledgerTotalPages = Math.max(1, Math.ceil(displayLedger.length / REFERRAL_LIST_PAGE_SIZE));
    const safeLedgerPage = Math.min(Math.max(1, ledgerPage), ledgerTotalPages);
    const paginatedLedger = useMemo(() => {
        const start = (safeLedgerPage - 1) * REFERRAL_LIST_PAGE_SIZE;
        return displayLedger.slice(start, start + REFERRAL_LIST_PAGE_SIZE);
    }, [displayLedger, safeLedgerPage]);

    const copyInvite = async () => {
        if (!overview) return;
        try {
            await navigator.clipboard.writeText(
                isZh
                    ? `${storefrontName} 邀请你来逛逛\n邀请码：${overview.inviteCode}\n${shareUrl}`
                    : `${storefrontName} invitation\nCode: ${overview.inviteCode}\n${shareUrl}`,
            );
            setCopied(true);
            onNotify(isZh ? '邀请码和邀请链接已复制' : 'Invitation code and link copied');
            window.setTimeout(() => setCopied(false), 1800);
        } catch {
            onNotify(isZh ? '复制失败，请手动复制' : 'Could not copy');
        }
    };

    const share = async () => {
        if (!overview) return;
        if (!navigator.share) {
            await copyInvite();
            return;
        }
        try {
            await navigator.share({
                title: isZh ? `${storefrontName} 好友邀请` : `${storefrontName} invitation`,
                text: isZh
                    ? `我的邀请码：${overview.inviteCode}`
                    : `My invitation code: ${overview.inviteCode}`,
                url: shareUrl,
            });
        } catch {
            // Closing the native share sheet is not an error for the customer.
        }
    };

    return (
        <Subpage title={isZh ? '邀请返利' : 'Referral rewards'} language={language} onBack={onBack}>
            {programQuery.isLoading || overviewQuery.isLoading ? (
                <PageSkeleton label={isZh ? '正在加载邀请返利' : 'Loading referral rewards'} />
            ) : !customer ? (
                <EmptyState
                    icon={<Gift />}
                    title={isZh ? '登录后查看邀请返利' : 'Sign in to view referral rewards'}
                    detail={
                        isZh
                            ? '登录后可获取专属邀请码、生成海报并查看奖励流水。'
                            : 'Sign in for your code, posters and reward activity.'
                    }
                    action={isZh ? '去登录' : 'Sign in'}
                    onAction={onLogin}
                />
            ) : !programQuery.data?.enabled ? (
                <EmptyState
                    icon={<Gift />}
                    title={isZh ? '邀请返利暂未开放' : 'Referral rewards are unavailable'}
                    detail={
                        isZh
                            ? '活动开放后，这里会显示你的邀请码和奖励明细。'
                            : 'Your invitation code and rewards will appear here when the program opens.'
                    }
                />
            ) : overviewQuery.error || !overview ? (
                <EmptyState
                    icon={<Gift />}
                    title={isZh ? '邀请信息加载失败' : 'Could not load referrals'}
                    detail={
                        overviewQuery.error instanceof Error
                            ? overviewQuery.error.message
                            : isZh
                              ? '请稍后重试'
                              : 'Try again later'
                    }
                    action={isZh ? '重试' : 'Retry'}
                    onAction={() => void overviewQuery.refetch()}
                />
            ) : (
                <div className="mx-auto grid w-full min-w-0 max-w-5xl overflow-hidden gap-4 px-3 pb-10 pt-3 lg:grid-cols-[1.15fr_0.85fr] lg:px-6">
                    <section className="referral-invite">
                        <h1 className="referral-invite-title">
                            {isZh ? '邀请好友，获得奖励' : 'Invite friends, earn rewards'}
                        </h1>
                        <p className="referral-invite-description">
                            {isZh
                                ? `好友成功消费，你可获得 ${overview.rewardRate}% 奖励用于消费抵扣。`
                                : `Earn ${overview.rewardRate}% in rewards when a friend makes a purchase.`}
                        </p>
                        <div className="referral-invite-code">
                            <small className="referral-invite-code-label">
                                {isZh ? '我的邀请码' : 'MY INVITATION CODE'}
                            </small>
                            <div className="referral-invite-code-row">
                                <strong className="referral-invite-code-value">{overview.inviteCode}</strong>
                                <button
                                    type="button"
                                    className="referral-invite-copy"
                                    onClick={() => void copyInvite()}
                                    aria-label={isZh ? '复制邀请码' : 'Copy invitation code'}
                                >
                                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                                </button>
                            </div>
                            <p className="referral-invite-url">{shareUrl}</p>
                        </div>
                        <div className="referral-invite-actions">
                            <button
                                type="button"
                                className="referral-invite-share"
                                onClick={() => void share()}
                            >
                                <Share2 className="size-4" />
                                {isZh ? '立即分享' : 'Share now'}
                            </button>
                            {hasPosterTemplates && (
                                <button
                                    type="button"
                                    className="referral-invite-poster"
                                    onClick={() => setShowPoster(true)}
                                >
                                    <Image className="size-4" />
                                    {isZh ? '生成海报' : 'Create poster'}
                                </button>
                            )}
                        </div>
                    </section>

                    <section className="grid grid-cols-2 gap-3">
                        <SummaryCard
                            icon={<WalletCards />}
                            label={isZh ? '可用奖励' : 'Available'}
                            value={formatMoney(wallet?.availableBalance ?? 0, market.currencyCode, locale)}
                            accent="text-emerald-600 bg-emerald-50"
                        />
                        <SummaryCard
                            icon={<Gift />}
                            label={isZh ? '待生效' : 'Pending'}
                            value={formatMoney(wallet?.pendingBalance ?? 0, market.currencyCode, locale)}
                            accent="text-amber-600 bg-amber-50"
                        />
                        <SummaryCard
                            icon={<Users />}
                            label={isZh ? '已邀请' : 'Invited'}
                            value={String(overview.invitedCount)}
                            accent="text-blue-600 bg-blue-50"
                        />
                        <SummaryCard
                            icon={<ShoppingBag />}
                            label={isZh ? '已消费好友' : 'Purchased'}
                            value={String(overview.purchasedInviteeCount)}
                            accent="text-violet-600 bg-violet-50"
                        />
                        <div className="col-span-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
                            <div className="mb-3 flex items-center justify-between">
                                <strong className="text-sm font-extrabold text-slate-900">
                                    {isZh ? '奖励概览' : 'Reward overview'}
                                </strong>
                                <RewardInfo isZh={isZh} releaseDelayDays={overview.releaseDelayDays} />
                            </div>
                            <dl className="m-0 grid grid-cols-2 divide-x divide-slate-200 rounded-xl bg-slate-50 py-3 text-center">
                                <div className="min-w-0 px-3">
                                    <dt className="text-xs font-semibold text-slate-500">
                                        {isZh ? '累计获得' : 'Total earned'}
                                    </dt>
                                    <dd className="mb-0 mt-1 truncate text-base font-black tabular-nums text-slate-900">
                                        {formatMoney(
                                            rewardSummary?.grossReward ?? 0,
                                            market.currencyCode,
                                            locale,
                                        )}
                                    </dd>
                                </div>
                                <div className="min-w-0 px-3">
                                    <dt className="text-xs font-semibold text-slate-500">
                                        {isZh ? '退款扣回' : 'Refund clawbacks'}
                                    </dt>
                                    <dd className="mb-0 mt-1 truncate text-base font-black tabular-nums text-red-600">
                                        -
                                        {formatMoney(
                                            rewardSummary?.clawedBackReward ?? 0,
                                            market.currencyCode,
                                            locale,
                                        )}
                                    </dd>
                                </div>
                            </dl>
                        </div>
                    </section>

                    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-1">
                        <div className="mb-3 flex items-center justify-between">
                            <h2 className="m-0 text-lg font-black text-slate-900">
                                {isZh ? '邀请记录' : 'Invitees'}
                            </h2>
                            <span className="text-xs font-bold tabular-nums text-slate-500">
                                {overview.invitedCount}
                            </span>
                        </div>
                        {overview.invitees.length ? (
                            <>
                                <div className="divide-y divide-slate-100">
                                    {paginatedInvitees.map(invitee => (
                                        <div key={invitee.id} className="flex items-center gap-3 py-3">
                                            <span className="grid size-10 place-items-center rounded-full bg-amber-50/80 font-bold text-amber-800">
                                                {invitee.displayName.slice(0, 1)}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <strong className="block truncate text-sm text-slate-900">
                                                    {invitee.displayName}
                                                </strong>
                                                <small className="text-slate-500">
                                                    {new Intl.DateTimeFormat(locale, {
                                                        dateStyle: 'medium',
                                                    }).format(new Date(invitee.boundAt))}
                                                </small>
                                            </div>
                                            <span
                                                className={`rounded-full px-2 py-1 text-[11px] font-bold ${invitee.firstPaidOrderAt ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                                            >
                                                {invitee.firstPaidOrderAt
                                                    ? isZh
                                                        ? '已消费'
                                                        : 'Purchased'
                                                    : isZh
                                                      ? '未消费'
                                                      : 'No purchase'}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <ListPagination
                                    currentPage={safeInviteePage}
                                    totalPages={inviteeTotalPages}
                                    totalItems={overview.invitees.length}
                                    onPageChange={setInviteePage}
                                    isZh={isZh}
                                />
                            </>
                        ) : (
                            <p className="py-8 text-center text-sm text-slate-500">
                                {isZh
                                    ? '还没有邀请记录，分享给第一位好友吧'
                                    : 'No invitees yet. Share with your first friend.'}
                            </p>
                        )}
                    </section>

                    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-1">
                        <div className="mb-3 flex items-center justify-between">
                            <h2 className="m-0 text-lg font-black text-slate-900">
                                {isZh ? '奖励流水' : 'Reward activity'}
                            </h2>
                            <span className="text-xs font-bold tabular-nums text-slate-500">
                                {displayLedger.length}
                            </span>
                        </div>
                        {displayLedger.length ? (
                            <>
                                <div className="divide-y divide-slate-100">
                                    {paginatedLedger.map(entry => (
                                        <LedgerRow
                                            key={entry.id}
                                            entry={entry}
                                            locale={locale}
                                            language={language}
                                        />
                                    ))}
                                </div>
                                <ListPagination
                                    currentPage={safeLedgerPage}
                                    totalPages={ledgerTotalPages}
                                    totalItems={displayLedger.length}
                                    onPageChange={setLedgerPage}
                                    isZh={isZh}
                                />
                            </>
                        ) : (
                            <p className="py-8 text-center text-sm text-slate-500">
                                {isZh ? '暂无奖励流水' : 'No reward activity yet'}
                            </p>
                        )}
                    </section>
                </div>
            )}
            {showPoster && hasPosterTemplates && overview && programQuery.data && (
                <ReferralPosterModal
                    inviteCode={overview.inviteCode}
                    storefrontName={storefrontName}
                    logoUrl={logoUrl}
                    language={language}
                    rewardRate={overview.rewardRate}
                    channelId={programQuery.data.channelId}
                    systemTemplateConfigs={programQuery.data.systemPosterTemplateConfigs ?? []}
                    templates={programQuery.data.posterTemplates}
                    templateConfigs={programQuery.data.posterTemplateConfigs ?? []}
                    defaultTemplate={programQuery.data.defaultPosterTemplate}
                    onClose={() => setShowPoster(false)}
                    onNotify={onNotify}
                />
            )}
        </Subpage>
    );
}

function SummaryCard({
    icon,
    label,
    value,
    accent,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    accent: string;
}) {
    return (
        <div className="flex min-h-32 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-4 text-center shadow-sm">
            <span className={`grid size-10 place-items-center rounded-xl ${accent} [&_svg]:size-[18px]`}>
                {icon}
            </span>
            <strong className="mt-3 block w-full truncate text-center text-xl font-black leading-none tabular-nums text-slate-900">
                {value}
            </strong>
            <small className="mt-2 block text-center text-xs font-semibold leading-4 text-slate-500">
                {label}
            </small>
        </div>
    );
}

function RewardInfo({ isZh, releaseDelayDays }: { isZh: boolean; releaseDelayDays: number }) {
    return (
        <details className="group relative">
            <summary
                className="grid size-8 cursor-pointer list-none place-items-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden"
                aria-label={isZh ? '查看奖励说明' : 'View reward details'}
            >
                <Info className="size-4" aria-hidden="true" />
            </summary>
            <div
                className="absolute right-0 z-20 mt-2 w-[min(18rem,calc(100vw-3.5rem))] rounded-xl border border-slate-200 bg-white p-3 text-left text-xs font-medium leading-5 text-slate-600 shadow-[0_14px_36px_-16px_rgba(15,23,42,0.45)]"
                role="note"
            >
                {isZh
                    ? `奖励在订单成功后进入待生效，默认 ${releaseDelayDays} 天后可用，可用于消费抵扣。`
                    : `Rewards become available ${releaseDelayDays} days after payment and can be applied to future orders.`}
            </div>
        </details>
    );
}

function LedgerRow({
    entry,
    locale,
    language,
}: {
    entry: ReferralLedgerEntry;
    locale: string;
    language: StorefrontLanguage;
}) {
    const delta = entry.availableDelta || entry.pendingDelta || entry.reservedDelta;
    const isPositive = delta > 0;
    const labels: Record<string, [string, string]> = {
        REWARD_PENDING: ['奖励待生效', 'Reward pending'],
        REWARD_AVAILABLE: ['奖励已获得', 'Reward earned'],
        REWARD_RELEASED: ['奖励已生效', 'Reward released'],
        REFUND_CLAWBACK: ['退款扣回', 'Refund clawback'],
        SPEND_RESERVED: ['订单抵扣', 'Order spend'],
        SPEND_CAPTURED: ['抵扣已确认', 'Spend captured'],
        SPEND_REFUNDED: ['抵扣退回', 'Spend refunded'],
        WITHDRAWAL_RESERVED: ['提款申请', 'Withdrawal requested'],
        WITHDRAWAL_PAID: ['提款已支付', 'Withdrawal paid'],
        WITHDRAWAL_REJECTED: ['提款退回', 'Withdrawal returned'],
        WITHDRAWAL_CANCELLED: ['提款取消', 'Withdrawal cancelled'],
        ADMIN_ADJUSTMENT: ['人工调整', 'Manual adjustment'],
    };
    const label = labels[entry.eventType]?.[language === 'zh' ? 0 : 1] ?? entry.eventType;
    return (
        <div className="flex items-center gap-3 py-3">
            <span
                className={`grid size-9 place-items-center rounded-full ${isPositive ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}
            >
                <WalletCards className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
                <strong className="block truncate text-sm text-slate-900">{label}</strong>
                <small className="text-slate-500">
                    {new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(
                        new Date(entry.createdAt),
                    )}
                </small>
            </div>
            <strong className={isPositive ? 'text-emerald-600' : 'text-slate-900'}>
                {delta > 0 ? '+' : ''}
                {formatMoney(delta, entry.currencyCode, locale)}
            </strong>
        </div>
    );
}

function ListPagination({
    currentPage,
    totalPages,
    totalItems,
    onPageChange,
    isZh,
}: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    onPageChange: (page: number) => void;
    isZh: boolean;
}) {
    if (totalItems <= 0) return null;
    return (
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
            <span>
                {isZh
                    ? `共 ${totalItems} 条 · 第 ${currentPage}/${totalPages} 页`
                    : `${totalItems} items · Page ${currentPage}/${totalPages}`}
            </span>
            <div className="flex items-center gap-1.5">
                <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => onPageChange(currentPage - 1)}
                    aria-label={isZh ? '上一页' : 'Previous page'}
                    className="flex h-7 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                    <ChevronLeft className="size-3.5" aria-hidden="true" />
                    <span>{isZh ? '上一页' : 'Prev'}</span>
                </button>
                <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => onPageChange(currentPage + 1)}
                    aria-label={isZh ? '下一页' : 'Next page'}
                    className="flex h-7 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                    <span>{isZh ? '下一页' : 'Next'}</span>
                    <ChevronRight className="size-3.5" aria-hidden="true" />
                </button>
            </div>
        </div>
    );
}
