import {
    ChevronLeft,
    ChevronRight,
    CircleDollarSign,
    Gift,
    Settings2,
    UserPlus,
    Users,
    WalletCards,
} from 'lucide-react';
import React from 'react';
import { missingDisplayLabel } from '../../../../common/src/display-localization';
import { referralStatusDisplayLabel as statusLabel } from '../../../../common/src/system-display-labels';
import { AdminButton, AdminInput, AdminSelect } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { PageSizeSelect } from '../../components/PageSizeSelect';
import {
    ReferralPosterRecord,
    ReferralProgramRecord,
    ReferralReportsResult,
} from '../../graphql/marketing.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatMoney, majorInputToMoney } from '../Sales/sales-utils';
import { TabButton } from '../Settings/settings-ui';
import { PosterDraft, ProgramDraft, ReferralTab } from './referrals-types';
export { statusLabel };

export function TableCard({
    title,
    description,
    children,
    comparison = false,
    subtitle,
    emptyMessage,
}: {
    title: string;
    description: string;
    children: React.ReactNode;
    comparison?: boolean;
    subtitle?: string;
    emptyMessage?: string;
}) {
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
            <div className="admin-section-title-line border-b border-slate-200 px-4 py-3">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    {title}
                    <FeatureHelpButton topic="marketing.referrals" title={title} description={description} />
                </h2>
                {subtitle && <p>{subtitle}</p>}
            </div>
            <div
                className={comparison ? 'admin-comparison-scroll overflow-x-auto' : 'overflow-x-auto'}
                tabIndex={comparison ? 0 : undefined}
                role={comparison ? 'region' : undefined}
                aria-label={comparison ? title : undefined}
            >
                {comparison && <p className="admin-mobile-table-hint">左右滑动查看完整{title}</p>}
                {children}
            </div>
            {emptyMessage && (
                <div role="status" className="px-4 py-8 text-center text-xs text-slate-400">
                    {emptyMessage}
                </div>
            )}
        </section>
    );
}
export function Th({ children, sticky = false }: { children: React.ReactNode; sticky?: boolean }) {
    return (
        <th
            scope="col"
            className={`whitespace-nowrap bg-slate-50 px-3 py-3 font-bold text-slate-500 ${sticky ? 'sticky right-0 z-20 border-l border-slate-200' : ''}`}
        >
            {children}
        </th>
    );
}
export function Td({
    children,
    label,
    sticky = false,
}: {
    children: React.ReactNode;
    label?: string;
    sticky?: boolean;
}) {
    return (
        <td
            data-label={label}
            className={`h-[52px] whitespace-nowrap px-3 py-0 text-slate-700 ${sticky ? 'sticky right-0 z-10 border-l border-slate-200 bg-white' : ''}`}
        >
            {children}
        </td>
    );
}
export function EmptyRow({ colSpan }: { colSpan: number }) {
    return (
        <tr>
            <td colSpan={colSpan} className="p-10 text-center text-xs text-slate-400">
                当前条件下没有数据
            </td>
        </tr>
    );
}
export function NameEmail({ name, email }: { name: string; email: string }) {
    return (
        <div className="min-w-0">
            <div className="truncate font-bold text-slate-900">{name || email}</div>
            <div className="truncate text-[10px] text-slate-400">{email}</div>
        </div>
    );
}
export function MoneyDelta({ value, currency }: { value: number; currency: string }) {
    return (
        <span
            className={`font-mono font-bold ${value > 0 ? 'text-emerald-600' : value < 0 ? 'text-rose-600' : 'text-slate-400'}`}
        >
            {value > 0 ? '+' : ''}
            {formatMoney(value, currency)}
        </span>
    );
}
export function StatusBadge({ value }: { value: string }) {
    const cls = ['PAID', 'AVAILABLE'].includes(value)
        ? 'bg-emerald-100 text-emerald-700'
        : ['REJECTED', 'REVERSED', 'CANCELLED'].includes(value)
          ? 'bg-rose-100 text-rose-700'
          : value === 'APPROVED'
            ? 'bg-blue-100 text-blue-700'
            : 'bg-amber-100 text-amber-700';
    return (
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>{statusLabel(value)}</span>
    );
}
export function ActionButton({
    label,
    onClick,
    positive = false,
}: {
    label: string;
    onClick: () => void;
    positive?: boolean;
}) {
    return (
        <AdminButton
            type="button"
            onClick={onClick}
            className={`rounded px-2 py-1 text-[10px] font-bold ${positive ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-rose-50 hover:text-rose-600'}`}
        >
            {label}
        </AdminButton>
    );
}
export function ReportPagination({
    pageSize,
    onPageSizeChange,
    loading,
    skip,
    total,
    onChange,
}: {
    pageSize: number;
    onPageSizeChange: (size: number) => void;
    loading: boolean;
    skip: number;
    total: number;
    onChange: (value: number) => void;
}) {
    const page = Math.floor(skip / pageSize);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return (
        <div className="flex flex-wrap gap-y-3 gap-x-4 items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            <span>
                共 {total} 条，第 {page + 1}/{totalPages} 页
            </span>
            <div className="flex flex-wrap items-center gap-2">
                <PageSizeSelect pageSize={pageSize} onPageSizeChange={onPageSizeChange} disabled={loading} />
                <AdminButton
                    type="button"
                    disabled={loading || skip === 0}
                    onClick={() => onChange(skip - pageSize)}
                    aria-label="上一页"
                    className="rounded border border-slate-300 bg-white p-1.5 disabled:opacity-40"
                >
                    <ChevronLeft className="h-4 w-4" />
                </AdminButton>
                <AdminButton
                    type="button"
                    disabled={loading || skip + pageSize >= total}
                    onClick={() => onChange(skip + pageSize)}
                    aria-label="下一页"
                    className="rounded border border-slate-300 bg-white p-1.5 disabled:opacity-40"
                >
                    <ChevronRight className="h-4 w-4" />
                </AdminButton>
            </div>
        </div>
    );
}
export function OverviewMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
    return (
        <div className="border-b border-slate-200 p-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
            <div className="text-[10px] font-bold text-slate-400">{label}</div>
            <strong className="mt-1 block text-lg text-slate-900">{value}</strong>
            {detail && (
                <div className="mt-1 truncate text-[9px] text-slate-500" title={detail}>
                    {detail}
                </div>
            )}
        </div>
    );
}
export function SmallMetric({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div className="text-[9px] font-bold text-slate-400">{label}</div>
            <div className="mt-1 truncate font-mono text-[11px] font-bold text-slate-800">{value}</div>
        </div>
    );
}
export function ToggleField({
    label,
    detail,
    checked,
    onChange,
}: {
    label: string;
    detail: string;
    checked: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
            <span>
                <strong className="text-xs text-slate-800">{label}</strong>
                <small className="mt-1 block text-[10px] leading-4 text-slate-400">{detail}</small>
            </span>
            <AdminInput
                type="checkbox"
                checked={checked}
                onChange={event => onChange(event.target.checked)}
                className="h-4 w-4"
            />
        </label>
    );
}
export function NumberField({
    label,
    value,
    min,
    max,
    step,
    onChange,
    detail,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
    detail?: string;
}) {
    return (
        <AdminField
            className="block text-[11px] font-bold text-slate-600"
            label={label}
            description={
                detail && (
                    <small className="mt-1 block text-[10px] font-normal leading-4 text-slate-400">
                        {detail}
                    </small>
                )
            }
        >
            <AdminInput
                type="number"
                value={value}
                min={min}
                max={max}
                step={step}
                onChange={event => onChange(Number(event.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-normal text-slate-900"
            />
        </AdminField>
    );
}
export function TextField({
    label,
    value,
    onChange,
    type = 'text',
    placeholder,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    type?: string;
    placeholder?: string;
}) {
    return (
        <AdminField className="mt-3 block text-[11px] font-bold text-slate-600" label={label}>
            <AdminInput
                type={type}
                value={value}
                onChange={event => onChange(event.target.value)}
                placeholder={placeholder}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-900"
            />
        </AdminField>
    );
}
export function FormSelect({
    label,
    value,
    onChange,
    options,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: string[][];
}) {
    return (
        <AdminField className="block text-[11px] font-bold text-slate-600" label={label}>
            <AdminSelect
                value={value}
                onChange={event => onChange(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-900"
            >
                {options.map(([key, text]) => (
                    <option key={key} value={key}>
                        {text}
                    </option>
                ))}
            </AdminSelect>
        </AdminField>
    );
}
export function ModalFooter({
    onCancel,
    onConfirm,
    pending,
    disabled,
    confirmLabel,
    danger = false,
}: {
    onCancel: () => void;
    onConfirm: () => void;
    pending: boolean;
    disabled: boolean;
    confirmLabel: string;
    danger?: boolean;
}) {
    return (
        <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
            <AdminButton
                type="button"
                onClick={onCancel}
                className="rounded-lg bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700"
            >
                取消
            </AdminButton>
            <AdminButton
                type="button"
                onClick={onConfirm}
                disabled={pending || disabled}
                className={`rounded-lg px-4 py-2 text-xs font-bold text-white disabled:opacity-50 ${danger ? 'bg-rose-600' : 'bg-blue-600'}`}
            >
                {pending ? '处理中…' : confirmLabel}
            </AdminButton>
        </div>
    );
}

export function programDraft(program: ReferralProgramRecord): ProgramDraft {
    return {
        expectedUpdatedAt: program.updatedAt,
        enabled: program.enabled,
        rewardRate: program.rewardRate,
        releaseDelayDays: program.releaseDelayDays,
        minimumOrderAmount: (program.minimumOrderAmount / 100).toFixed(2),
        maxRewardPerOrder:
            program.maxRewardPerOrder == null ? '' : (program.maxRewardPerOrder / 100).toFixed(2),
        allowBalanceSpend: program.allowBalanceSpend,
        attributionWindowDays: program.attributionWindowDays,
        defaultPosterTemplate: program.defaultPosterTemplate,
        posterTemplates: [...(program.posterTemplates ?? [])],
    };
}
export function programDraftError(draft: ProgramDraft) {
    if (!Number.isFinite(draft.rewardRate) || draft.rewardRate < 0 || draft.rewardRate > 100)
        return '返利比例必须在0%到100%之间';
    if (
        !Number.isInteger(draft.releaseDelayDays) ||
        draft.releaseDelayDays < 0 ||
        draft.releaseDelayDays > 30
    )
        return '奖励等待期必须是0到30天的整数';
    if (Number(draft.minimumOrderAmount) < 0) return '最低有效消费不能小于0';
    if (draft.maxRewardPerOrder && Number(draft.maxRewardPerOrder) <= 0) return '单笔返利上限必须大于0或留空';
    if (
        !Number.isInteger(draft.attributionWindowDays) ||
        draft.attributionWindowDays < 0 ||
        draft.attributionWindowDays > 365
    )
        return '归因有效期必须是0到365的整数，0表示永久有效';
    return '';
}
export function posterDraft(source: ReferralPosterRecord | 'NEW'): PosterDraft {
    const copyFields = [
        'titleZh',
        'titleEn',
        'headlineZh',
        'headlineEn',
        'siteIntroZh',
        'siteIntroEn',
        'featureOneTitleZh',
        'featureOneTitleEn',
        'featureOneTextZh',
        'featureOneTextEn',
        'featureTwoTitleZh',
        'featureTwoTitleEn',
        'featureTwoTextZh',
        'featureTwoTextEn',
        'featureThreeTitleZh',
        'featureThreeTitleEn',
        'featureThreeTextZh',
        'featureThreeTextEn',
        'qrEyebrowZh',
        'qrEyebrowEn',
        'qrTitleZh',
        'qrTitleEn',
        'qrDescriptionZh',
        'qrDescriptionEn',
        'rewardTextZh',
        'rewardTextEn',
        'sceneOneZh',
        'sceneOneEn',
        'sceneTwoZh',
        'sceneTwoEn',
        'sceneThreeZh',
        'sceneThreeEn',
        'sceneFourZh',
        'sceneFourEn',
        'ctaTextZh',
        'ctaTextEn',
        'footerTitleZh',
        'footerTitleEn',
        'footerTextZh',
        'footerTextEn',
        'serviceTextZh',
        'serviceTextEn',
    ] as const;
    const copy = Object.fromEntries(
        copyFields.map(field => [field, source === 'NEW' ? '' : source[field]]),
    ) as Pick<PosterDraft, (typeof copyFields)[number]>;
    return {
        ...copy,
        id: source === 'NEW' ? undefined : source.id || undefined,
        name: source === 'NEW' ? '' : source.id ? source.name : `${source.name} · 本店`,
        enabled: source === 'NEW' ? false : source.enabled,
        position: source === 'NEW' ? 0 : source.position,
        layoutVariant: 'STANDARD_CENTER',
        posterBackgroundAssetId: source === 'NEW' ? '' : (source.posterBackgroundAsset?.id ?? ''),
        shareBackgroundAssetId: source === 'NEW' ? '' : (source.shareBackgroundAsset?.id ?? ''),
        foregroundColor: source === 'NEW' ? '#152c49' : source.foregroundColor,
        accentColor: source === 'NEW' ? '#2565ae' : source.accentColor,
        overlayOpacity: source === 'NEW' ? 0 : source.overlayOpacity,
    };
}
export function posterDraftError(draft: PosterDraft) {
    if (
        ![draft.name, draft.titleZh, draft.headlineZh, draft.rewardTextZh, draft.siteIntroZh].every(value =>
            value.trim(),
        )
    )
        return '模板名称和中文文案不能为空，英文会在后台补齐';
    if (!Number.isInteger(draft.position) || draft.position < 0 || draft.position > 100_000)
        return '排序必须是0到100000的整数';
    if (!Number.isInteger(draft.overlayOpacity) || draft.overlayOpacity < 0 || draft.overlayOpacity > 80)
        return '遮罩透明度必须是0到80的整数';
    return '';
}
export function signedMoney(value: string, currency: string, allowNegative: boolean) {
    const number = Number(value);
    if (!Number.isFinite(number) || (!allowNegative && number <= 0)) return null;
    const absolute = majorInputToMoney(String(Math.abs(number)), currency);
    return absolute == null ? null : number < 0 ? -absolute : absolute;
}
export function posterLabel(value: string, program?: ReferralProgramRecord) {
    return (
        [...(program?.systemPosterTemplateConfigs ?? []), ...(program?.posterTemplateConfigs ?? [])].find(
            template => template.id === value,
        )?.name ?? missingDisplayLabel('template')
    );
}
export function errorText(error: unknown) {
    return toUserFacingError(error, '操作失败，请稍后重试');
}

export function ReferralHeading({
    title = '分销与返利',
    subtitle,
}: { title?: string; subtitle?: string } = {}) {
    return (
        <div className="admin-page-title-line">
            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                {title}
                <FeatureHelpButton
                    topic="marketing.referrals"
                    title="分销与返利"
                    description={'一级邀请返利、推广员、奖励、钱包、提现和分享海报统一管理'}
                />
            </h1>
            {subtitle && <p>{subtitle}</p>}
        </div>
    );
}

export function ReferralTabs({
    activeTab,
    reports,
    onChange,
}: {
    activeTab: ReferralTab;
    reports?: ReferralReportsResult;
    onChange: (tab: ReferralTab) => void;
}) {
    const tabs = [
        ['SETTINGS', '功能设置', Settings2],
        ['PROMOTERS', `推广员团队 ${reports?.referralInviterSummaries.totalItems ?? 0}`, Users],
        ['RELATIONSHIPS', `邀请关系明细 ${reports?.referralRelationships.totalItems ?? 0}`, UserPlus],
        ['REWARDS', `返利订单 ${reports?.referralRewards.totalItems ?? 0}`, Gift],
        ['LEDGER', '钱包流水', WalletCards],
        ['WITHDRAWALS', `提款 ${reports?.referralWithdrawals.totalItems ?? 0}`, CircleDollarSign],
    ] as const;

    return (
        <>
            <AdminField label="分销分类" className="admin-mobile-section-select">
                <AdminSelect
                    aria-label="分销分类"
                    value={activeTab}
                    onChange={event => onChange(event.target.value as ReferralTab)}
                    className="min-w-0 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                    {tabs.map(([value, label]) => (
                        <option key={value} value={value}>
                            {label}
                        </option>
                    ))}
                </AdminSelect>
            </AdminField>
            <nav
                aria-label="分销与返利子导航"
                className="hidden max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 text-xs shadow-2xs md:flex"
            >
                {tabs.map(([tab, label, Icon]) => (
                    <TabButton
                        key={tab}
                        active={activeTab === tab}
                        onClick={() => onChange(tab)}
                        icon={<Icon className="h-3.5 w-3.5" />}
                    >
                        {label}
                    </TabButton>
                ))}
            </nav>
        </>
    );
}
