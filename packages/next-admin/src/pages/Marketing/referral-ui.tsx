import { ChevronLeft, ChevronRight } from 'lucide-react';
import React from 'react';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { ReferralPosterRecord, ReferralProgramRecord } from '../../graphql/marketing.graphql';
import { getStatusLabel } from '../../utils/status-labels';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatMoney, majorInputToMoney } from '../Sales/sales-utils';
import { PosterDraft, ProgramDraft, WithdrawalAction } from './referrals-types';

export const PAGE_SIZE = 50;

export function TableCard({
    title,
    description,
    children,
}: {
    title: string;
    description: string;
    children: React.ReactNode;
}) {
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
            <div className="border-b border-slate-200 p-4">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    {title}
                    <FeatureHelpButton topic="marketing.referrals" title={title} />
                </h2>
                <p className="mt-1 text-[11px] text-slate-500">{description}</p>
            </div>
            <div className="overflow-x-auto">{children}</div>
        </section>
    );
}
export function Th({ children }: { children: React.ReactNode }) {
    return (
        <th scope="col" className="whitespace-nowrap bg-slate-50 px-3 py-3 font-bold text-slate-500">
            {children}
        </th>
    );
}
export function Td({ children }: { children: React.ReactNode }) {
    return <td className="h-[52px] whitespace-nowrap px-3 py-0 text-slate-700">{children}</td>;
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
        <button
            type="button"
            onClick={onClick}
            className={`rounded px-2 py-1 text-[10px] font-bold ${positive ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-rose-50 hover:text-rose-600'}`}
        >
            {label}
        </button>
    );
}
export function ReportPagination({
    skip,
    total,
    onChange,
}: {
    skip: number;
    total: number;
    onChange: (value: number) => void;
}) {
    const page = Math.floor(skip / PAGE_SIZE);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    return (
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            <span>
                共 {total} 条，第 {page + 1}/{totalPages} 页
            </span>
            <div className="flex gap-2">
                <button
                    type="button"
                    disabled={skip === 0}
                    onClick={() => onChange(skip - PAGE_SIZE)}
                    aria-label="上一页"
                    className="rounded border border-slate-300 bg-white p-1.5 disabled:opacity-40"
                >
                    <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    disabled={skip + PAGE_SIZE >= total}
                    onClick={() => onChange(skip + PAGE_SIZE)}
                    aria-label="下一页"
                    className="rounded border border-slate-300 bg-white p-1.5 disabled:opacity-40"
                >
                    <ChevronRight className="h-4 w-4" />
                </button>
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
            <input
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
        <label className="block text-[11px] font-bold text-slate-600">
            {label}
            <input
                type="number"
                value={value}
                min={min}
                max={max}
                step={step}
                onChange={event => onChange(Number(event.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-normal text-slate-900"
            />
            {detail && (
                <small className="mt-1 block text-[10px] font-normal leading-4 text-slate-400">
                    {detail}
                </small>
            )}
        </label>
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
        <label className="mt-3 block text-[11px] font-bold text-slate-600">
            {label}
            <input
                type={type}
                value={value}
                onChange={event => onChange(event.target.value)}
                placeholder={placeholder}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-900"
            />
        </label>
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
        <label className="block text-[11px] font-bold text-slate-600">
            {label}
            <select
                value={value}
                onChange={event => onChange(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-900"
            >
                {options.map(([key, text]) => (
                    <option key={key} value={key}>
                        {text}
                    </option>
                ))}
            </select>
        </label>
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
            <button
                type="button"
                onClick={onCancel}
                className="rounded-lg bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700"
            >
                取消
            </button>
            <button
                type="button"
                onClick={onConfirm}
                disabled={pending || disabled}
                className={`rounded-lg px-4 py-2 text-xs font-bold text-white disabled:opacity-50 ${danger ? 'bg-rose-600' : 'bg-blue-600'}`}
            >
                {pending ? '处理中…' : confirmLabel}
            </button>
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
        draft.attributionWindowDays < 1 ||
        draft.attributionWindowDays > 365
    )
        return '归因有效期必须是1到365天的整数';
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
        ![
            draft.name,
            draft.titleZh,
            draft.titleEn,
            draft.headlineZh,
            draft.headlineEn,
            draft.rewardTextZh,
            draft.rewardTextEn,
            draft.siteIntroZh,
            draft.siteIntroEn,
        ].every(value => value.trim())
    )
        return '模板名称和中英文文案均不能为空';
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
export function statusLabel(value: string) {
    return (
        (
            {
                PENDING: '待处理',
                APPROVED: '已批准',
                PAID: '已打款',
                REJECTED: '已驳回',
                CANCELLED: '已取消',
                AVAILABLE: '已生效',
                PARTIALLY_REVERSED: '部分扣回',
                REVERSED: '已扣回',
            } as Record<string, string>
        )[value] ?? getStatusLabel(value)
    );
}
export function posterLabel(value: string, program?: ReferralProgramRecord) {
    return (
        [...(program?.systemPosterTemplateConfigs ?? []), ...(program?.posterTemplateConfigs ?? [])].find(
            template => template.id === value,
        )?.name ?? value
    );
}
export function withdrawalActionLabel(status: WithdrawalAction['status']) {
    return (
        { APPROVED: '批准申请', PAID: '登记已打款', REJECTED: '驳回申请', CANCELLED: '取消申请' } as Record<
            string,
            string
        >
    )[status];
}
export function withdrawalSuccess(status: WithdrawalAction['status']) {
    return (
        {
            APPROVED: '提款申请已批准，等待线下打款',
            PAID: '外部打款已登记，冻结余额已扣除',
            REJECTED: '提款申请已驳回，冻结金额已退回可用余额',
            CANCELLED: '提款申请已取消，冻结金额已退回可用余额',
        } as Record<string, string>
    )[status];
}
export function errorText(error: unknown) {
    return toUserFacingError(error, '操作失败，请稍后重试');
}

export function ReferralHeading() {
    return (
        <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                分销与返利
                <FeatureHelpButton topic="marketing.referrals" title="分销与返利" />
            </h1>
            <p className="mt-1 text-xs text-slate-500">
                一级邀请返利、推广员、奖励、钱包、提现和分享海报统一管理
            </p>
        </div>
    );
}
