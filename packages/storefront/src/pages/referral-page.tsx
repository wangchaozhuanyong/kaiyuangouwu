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
import { useEffect, useId, useMemo, useRef, useState } from 'react';

const REFERRAL_LIST_PAGE_SIZE = 10;

import { ShopApi } from '../api';
import { languageCodeFor } from '../i18n';
import { PUBLIC_QUERY_GC_TIME, ROUTE_QUERY_STALE_TIME, storefrontQueryKeys } from '../query-client';
import { referralShareUrl } from '../referral-attribution';
import { availablePosterTemplates } from '../referral-poster-layout';
import { ReferralPosterModal } from '../referral-poster-modal';
import { PageSkeleton } from '../route-loading';
import { storefrontErrorMessage } from '../storefront-errors';
import { ReferralPageContext } from '../storefront-page-contexts';
import { EmptyState, Subpage, SubpageBody } from '../storefront-ui/page-shell';
import { formatMoney } from '../storefront-ui/product-display';
import { ActiveCustomer, MarketConfig, ReferralLedgerEntry, StorefrontLanguage } from '../types';

import '../styles/referral.css';

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
    const [recordTab, setRecordTab] = useState<'invitees' | 'ledger'>('invitees');
    const recordId = useId();

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
        <Subpage
            className="referral-page"
            title={isZh ? '邀请返利' : 'Referral rewards'}
            language={language}
            onBack={onBack}
        >
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
                            ? storefrontErrorMessage(overviewQuery.error, language)
                            : isZh
                              ? '请稍后重试'
                              : 'Try again later'
                    }
                    action={isZh ? '重试' : 'Retry'}
                    onAction={() => void overviewQuery.refetch()}
                />
            ) : (
                // REFERRAL_CELEBRATION_20261002: user-approved campaign theme, independent of store skins.
                // Keep this marker and the scoped palette in referral.css when repairing skin rules.
                <SubpageBody className="desktop-referral-content" data-referral-theme="celebration">
                    <section className="referral-invite">
                        <div className="referral-invite-kicker">
                            <Gift aria-hidden="true" />
                            <span>{isZh ? '分享有礼' : 'SHARE & EARN'}</span>
                        </div>
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

                    <section className="referral-overview" aria-labelledby={`${recordId}-overview`}>
                        <div className="referral-overview-heading">
                            <h2 id={`${recordId}-overview`}>{isZh ? '奖励概览' : 'Reward overview'}</h2>
                            <RewardInfo isZh={isZh} releaseDelayDays={overview.releaseDelayDays} />
                        </div>
                        <dl className="referral-stat-grid">
                            <SummaryCard
                                icon={<WalletCards />}
                                label={isZh ? '可用奖励' : 'Available rewards'}
                                value={formatMoney(
                                    wallet?.availableBalance ?? 0,
                                    market.currencyCode,
                                    locale,
                                )}
                                prominent
                            />
                            <SummaryCard
                                icon={<Gift />}
                                label={isZh ? '待生效' : 'Pending rewards'}
                                value={formatMoney(wallet?.pendingBalance ?? 0, market.currencyCode, locale)}
                                prominent
                            />
                            <SummaryCard
                                icon={<Users />}
                                label={isZh ? '已邀请' : 'Invited'}
                                value={String(overview.invitedCount)}
                            />
                            <SummaryCard
                                icon={<ShoppingBag />}
                                label={isZh ? '已消费好友' : 'Purchased friends'}
                                value={String(overview.purchasedInviteeCount)}
                            />
                        </dl>
                        <dl className="referral-reward-totals">
                            <div>
                                <dt>{isZh ? '累计获得' : 'Total earned'}</dt>
                                <dd>
                                    {formatMoney(
                                        rewardSummary?.grossReward ?? 0,
                                        market.currencyCode,
                                        locale,
                                    )}
                                </dd>
                            </div>
                            <div>
                                <dt>{isZh ? '退款扣回' : 'Refund clawbacks'}</dt>
                                <dd>
                                    {formatMoney(
                                        rewardSummary?.clawedBackReward ? -rewardSummary.clawedBackReward : 0,
                                        market.currencyCode,
                                        locale,
                                    )}
                                </dd>
                            </div>
                        </dl>
                    </section>
                    <section
                        className="referral-records"
                        aria-label={isZh ? '邀请与奖励记录' : 'Invitation and reward records'}
                    >
                        <div
                            className="referral-record-tabs"
                            role="tablist"
                            aria-label={isZh ? '记录类型' : 'Record type'}
                            onKeyDown={event => {
                                const tabs = Array.from(
                                    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
                                );
                                const index = tabs.indexOf(event.target as HTMLButtonElement);
                                if (index < 0) return;
                                let next = index;
                                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = 1 - index;
                                else if (event.key === 'Home') next = 0;
                                else if (event.key === 'End') next = 1;
                                else return;
                                event.preventDefault();
                                setRecordTab(next === 0 ? 'invitees' : 'ledger');
                                tabs[next].focus();
                            }}
                        >
                            <button
                                type="button"
                                role="tab"
                                id={`${recordId}-invitees-tab`}
                                aria-controls={`${recordId}-invitees-panel`}
                                aria-selected={recordTab === 'invitees'}
                                tabIndex={recordTab === 'invitees' ? 0 : -1}
                                onClick={() => setRecordTab('invitees')}
                            >
                                {isZh ? '邀请记录' : 'Invitees'} <span>{overview.invitedCount}</span>
                            </button>
                            <button
                                type="button"
                                role="tab"
                                id={`${recordId}-ledger-tab`}
                                aria-controls={`${recordId}-ledger-panel`}
                                aria-selected={recordTab === 'ledger'}
                                tabIndex={recordTab === 'ledger' ? 0 : -1}
                                onClick={() => setRecordTab('ledger')}
                            >
                                {isZh ? '奖励流水' : 'Reward activity'} <span>{displayLedger.length}</span>
                            </button>
                        </div>
                        <div
                            className="referral-record-panel"
                            role="tabpanel"
                            id={`${recordId}-invitees-panel`}
                            aria-labelledby={`${recordId}-invitees-tab`}
                            tabIndex={0}
                            hidden={recordTab !== 'invitees'}
                        >
                            {overview.invitees.length ? (
                                <>
                                    <div className="referral-record-list">
                                        {paginatedInvitees.map(invitee => (
                                            <div key={invitee.id} className="referral-record-row">
                                                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] font-bold text-[var(--accent-ink)]">
                                                    {invitee.displayName.slice(0, 1)}
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <strong className="block truncate text-sm text-[var(--text)]">
                                                        {invitee.displayName}
                                                    </strong>
                                                    <small className="text-[var(--muted)]">
                                                        {new Intl.DateTimeFormat(locale, {
                                                            dateStyle: 'medium',
                                                        }).format(new Date(invitee.boundAt))}
                                                    </small>
                                                </div>
                                                <span
                                                    className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${invitee.firstPaidOrderAt ? 'bg-[color-mix(in_srgb,var(--success)_12%,var(--surface))] text-[var(--success)]' : 'bg-[var(--soft)] text-[var(--muted)]'}`}
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
                                <p className="referral-record-empty">
                                    <Gift aria-hidden="true" />
                                    {isZh
                                        ? '还没有邀请记录，分享给第一位好友吧'
                                        : 'No invitees yet. Share with your first friend.'}
                                </p>
                            )}
                        </div>

                        <div
                            className="referral-record-panel"
                            role="tabpanel"
                            id={`${recordId}-ledger-panel`}
                            aria-labelledby={`${recordId}-ledger-tab`}
                            tabIndex={0}
                            hidden={recordTab !== 'ledger'}
                        >
                            {displayLedger.length ? (
                                <>
                                    <div className="referral-record-list">
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
                                <p className="referral-record-empty">
                                    <WalletCards aria-hidden="true" />
                                    {isZh ? '暂无奖励流水' : 'No reward activity yet'}
                                </p>
                            )}
                        </div>
                    </section>
                </SubpageBody>
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
    prominent = false,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    prominent?: boolean;
}) {
    return (
        <div className={prominent ? 'referral-stat is-prominent' : 'referral-stat'}>
            <dt>
                <span className="referral-stat-icon" aria-hidden="true">
                    {icon}
                </span>
                {label}
            </dt>
            <dd>{value}</dd>
        </div>
    );
}

function RewardInfo({ isZh, releaseDelayDays }: { isZh: boolean; releaseDelayDays: number }) {
    const [open, setOpen] = useState(false);
    const helpRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const helpId = useId();

    useEffect(() => {
        if (!open) return;
        const closeOutside = (event: Event) => {
            if (event.target instanceof Node && !helpRef.current?.contains(event.target)) {
                setOpen(false);
            }
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setOpen(false);
            buttonRef.current?.focus();
        };
        document.addEventListener('pointerdown', closeOutside);
        document.addEventListener('focusin', closeOutside);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('pointerdown', closeOutside);
            document.removeEventListener('focusin', closeOutside);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [open]);

    return (
        <div ref={helpRef} className="referral-reward-help">
            <button
                ref={buttonRef}
                type="button"
                className="referral-reward-help-trigger"
                aria-label={isZh ? '查看奖励说明' : 'View reward details'}
                aria-expanded={open}
                aria-controls={helpId}
                onClick={() => setOpen(value => !value)}
            >
                <Info aria-hidden="true" />
                <span>{isZh ? '奖励说明' : 'Reward details'}</span>
            </button>
            <div
                id={helpId}
                className="referral-reward-help-popover"
                role="note"
                tabIndex={-1}
                hidden={!open}
            >
                <strong>{isZh ? '奖励生效与使用' : 'Availability and use'}</strong>
                {isZh
                    ? `奖励在订单成功后进入待生效，默认 ${releaseDelayDays} 天后可用，可用于消费抵扣。`
                    : `Rewards become available ${releaseDelayDays} days after payment and can be applied to future orders.`}
            </div>
        </div>
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
        SPEND_CANCELLED: ['抵扣已取消', 'Spend cancelled'],
        ORDER_CANCEL_CLAWBACK: ['订单取消扣回', 'Order cancellation clawback'],
        WALLET_USAGE_RESERVED: ['余额抵扣预留', 'Wallet spend reserved'],
        WALLET_USAGE_CAPTURED: ['余额抵扣完成', 'Wallet spend captured'],
        WALLET_USAGE_RELEASED: ['余额抵扣释放', 'Wallet spend released'],
        WALLET_USAGE_REFUNDED: ['余额抵扣退回', 'Wallet spend refunded'],
        WITHDRAWAL_RESERVED: ['提款申请', 'Withdrawal requested'],
        WITHDRAWAL_PAID: ['提款已支付', 'Withdrawal paid'],
        WITHDRAWAL_REJECTED: ['提款退回', 'Withdrawal returned'],
        WITHDRAWAL_CANCELLED: ['提款取消', 'Withdrawal cancelled'],
        ADMIN_ADJUSTMENT: ['人工调整', 'Manual adjustment'],
    };
    const label = labels[entry.eventType]?.[language === 'zh' ? 0 : 1] ?? entry.eventType;
    return (
        <div className="referral-record-row">
            <span className="referral-stat-icon" aria-hidden="true">
                <WalletCards />
            </span>
            <div className="min-w-0 flex-1">
                <strong className="block truncate text-sm text-[var(--text)]">{label}</strong>
                <small className="text-[var(--muted)]">
                    {new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(
                        new Date(entry.createdAt),
                    )}
                </small>
            </div>
            <strong
                className={`referral-ledger-amount ${isPositive ? 'text-[var(--success)]' : 'text-[var(--text)]'}`}
            >
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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 pt-3 text-xs text-[var(--muted)]">
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
                    className="flex min-h-11 items-center gap-1 rounded-[var(--skin-control-radius)] border border-[var(--line)] bg-[var(--surface)] px-2.5 font-medium text-[var(--muted)] transition-colors hover:bg-[var(--control-surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                    <ChevronLeft className="size-3.5" aria-hidden="true" />
                    <span>{isZh ? '上一页' : 'Prev'}</span>
                </button>
                <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => onPageChange(currentPage + 1)}
                    aria-label={isZh ? '下一页' : 'Next page'}
                    className="flex min-h-11 items-center gap-1 rounded-[var(--skin-control-radius)] border border-[var(--line)] bg-[var(--surface)] px-2.5 font-medium text-[var(--muted)] transition-colors hover:bg-[var(--control-surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                    <span>{isZh ? '下一页' : 'Next'}</span>
                    <ChevronRight className="size-3.5" aria-hidden="true" />
                </button>
            </div>
        </div>
    );
}
