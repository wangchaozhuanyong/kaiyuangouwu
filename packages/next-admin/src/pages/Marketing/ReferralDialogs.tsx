import { useMutation, useQuery } from '@apollo/client/react';
import { AlertCircle, ChevronRight, LoaderCircle, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { posterLayoutFields, type PosterCopyField } from '../../../../storefront/src/referral-poster-layout';
import { sensitiveActionContext } from '../../apollo';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { GET_ASSETS } from '../../graphql/catalog.graphql';
import {
    ADJUST_REFERRAL_BALANCE_MUTATION,
    CREATE_REFERRAL_POSTER_MUTATION,
    CREATE_REFERRAL_WITHDRAWAL_MUTATION,
    MARKETING_CUSTOMER_LOOKUP_QUERY,
    PROCESS_REFERRAL_WITHDRAWAL_MUTATION,
    REFERRAL_CUSTOMER_WALLETS_QUERY,
    ReferralPosterRecord,
    UPDATE_REFERRAL_POSTER_MUTATION,
} from '../../graphql/marketing.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { omitUnchangedEnglish } from '../../utils/english-edit-intent';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatMoney } from '../Sales/sales-utils';
import { LoadingState, Modal } from '../Settings/settings-ui';
import {
    FormSelect,
    ModalFooter,
    NameEmail,
    NumberField,
    SmallMetric,
    TextField,
    ToggleField,
    errorText,
    posterDraft,
    posterDraftError,
    signedMoney,
    withdrawalActionLabel,
    withdrawalSuccess,
} from './referral-ui';
import { ReferralPosterPreview } from './ReferralPosterPreview';
import { PosterAssetChoice, PosterAssetLookupResult, PosterDraft, WithdrawalAction } from './referrals-types';

export function WithdrawalActionDialog({
    action,
    onClose,
    onSaved,
    onError,
}: {
    action: WithdrawalAction;
    onClose: () => void;
    onSaved: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [externalReference, setExternalReference] = useState('');
    const [note, setNote] = useState('');
    const [process, state] = useMutation(PROCESS_REFERRAL_WITHDRAWAL_MUTATION);
    const submit = async () => {
        if (action.status === 'PAID' && !externalReference.trim())
            return onError('登记已打款必须填写外部打款流水号');
        if (action.status === 'REJECTED' && !note.trim()) return onError('驳回时必须填写原因');
        const confirmation = await requestConfirmation({
            title: `确认${withdrawalActionLabel(action.status)}？`,
            description: `申请 ${action.item.code} 涉及 ${formatMoney(action.item.amount, action.item.currencyCode)}，操作会写入财务审计流水。`,
            confirmLabel: '验证并处理',
            tone: 'warning',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        try {
            await process({
                variables: {
                    input: {
                        id: action.item.id,
                        status: action.status,
                        externalReference: externalReference.trim() || null,
                        note: note.trim() || null,
                    },
                },
                context: sensitiveActionContext(confirmation.currentPassword ?? ''),
            });
            await onSaved(withdrawalSuccess(action.status));
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <Modal
            title={withdrawalActionLabel(action.status)}
            description={`申请 ${action.item.code} · ${formatMoney(action.item.amount, action.item.currencyCode)}`}
            onClose={onClose}
        >
            <div className="rounded-xl bg-slate-50 p-3 text-xs">
                <NameEmail name={action.item.customerName} email={action.item.customerEmail} />
                <p className="mt-2">
                    收款：{action.item.payoutMethod} / {action.item.payoutAccountMasked}
                </p>
            </div>
            {action.status === 'PAID' && (
                <TextField
                    label="外部打款流水号 *"
                    value={externalReference}
                    onChange={setExternalReference}
                    placeholder="银行、支付宝或链上交易号"
                />
            )}
            <label className="mt-4 block text-[11px] font-bold text-slate-600">
                处理备注{action.status === 'REJECTED' ? ' *' : ''}
                <textarea
                    value={note}
                    onChange={event => setNote(event.target.value)}
                    rows={3}
                    maxLength={500}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-xs font-normal"
                    placeholder={
                        action.status === 'REJECTED'
                            ? '请填写驳回原因，余额会退回可用余额'
                            : '可选，写入审计记录'
                    }
                />
            </label>
            <ModalFooter
                onCancel={onClose}
                onConfirm={() => void submit()}
                pending={state.loading}
                disabled={
                    (action.status === 'PAID' && !externalReference.trim()) ||
                    (action.status === 'REJECTED' && !note.trim())
                }
                confirmLabel={withdrawalActionLabel(action.status)}
                danger={['REJECTED', 'CANCELLED'].includes(action.status)}
            />
        </Modal>
    );
}

export function FinancialDialog({
    mode,
    defaultCurrency,
    onClose,
    onSaved,
    onError,
}: {
    mode: 'WITHDRAW' | 'ADJUST';
    defaultCurrency: string;
    onClose: () => void;
    onSaved: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [search, setSearch] = useState('');
    const [customer, setCustomer] = useState<{ id: string; name: string; email: string } | null>(null);
    const [currency, setCurrency] = useState(defaultCurrency);
    const [amount, setAmount] = useState('');
    const [method, setMethod] = useState('ALIPAY');
    const [account, setAccount] = useState('');
    const [reason, setReason] = useState('');
    const deferredSearch = useDeferredValue(search.trim());
    const filter = deferredSearch
        ? {
              _or: [
                  { firstName: { contains: deferredSearch } },
                  { lastName: { contains: deferredSearch } },
                  { emailAddress: { contains: deferredSearch } },
                  { phoneNumber: { contains: deferredSearch } },
              ],
          }
        : undefined;
    const lookup = useQuery<{
        customers: {
            totalItems: number;
            items: Array<{
                id: string;
                firstName: string;
                lastName: string;
                emailAddress: string;
                phoneNumber: string | null;
            }>;
        };
    }>(MARKETING_CUSTOMER_LOOKUP_QUERY, {
        variables: { options: { take: 20, filter } },
        skip: Boolean(customer),
        fetchPolicy: 'cache-and-network',
    });
    const wallets = useQuery<{
        referralCustomerWallets: Array<{
            id: string;
            currencyCode: string;
            availableBalance: number;
            pendingBalance: number;
            reservedBalance: number;
        }>;
    }>(REFERRAL_CUSTOMER_WALLETS_QUERY, {
        variables: { customerId: customer?.id },
        skip: !customer,
        fetchPolicy: 'network-only',
    });
    const [createWithdrawal, withdrawalState] = useMutation(CREATE_REFERRAL_WITHDRAWAL_MUTATION);
    const [adjust, adjustState] = useMutation(ADJUST_REFERRAL_BALANCE_MUTATION);
    const effectiveCurrency = wallets.data?.referralCustomerWallets.some(
        wallet => wallet.currencyCode === currency,
    )
        ? currency
        : (wallets.data?.referralCustomerWallets[0]?.currencyCode ?? currency);
    const dialogTitle = mode === 'WITHDRAW' ? '代客户发起人工提款' : '人工调整返利余额';
    const dialogDescription =
        mode === 'WITHDRAW'
            ? '创建后从可用余额转入冻结余额，仍需后续审批与打款登记。'
            : '支持正负调整，必须填写业务原因，操作会永久写入审计流水。';
    const submit = async () => {
        if (!customer) return onError('请先选择客户');
        if (wallets.loading && !wallets.data) return onError('客户返利余额仍在读取，请稍后再试');
        if (wallets.error || !wallets.data) return onError('客户返利余额读取失败，请重新加载');
        const money = signedMoney(amount, effectiveCurrency, mode === 'ADJUST');
        if (money == null || money === 0)
            return onError(mode === 'ADJUST' ? '请输入非0的调整金额' : '请输入大于0的提款金额');
        if (!reason.trim()) return onError(mode === 'ADJUST' ? '请填写余额调整原因' : '请填写客服处理备注');
        if (mode === 'WITHDRAW' && !account.trim()) return onError('请填写脱敏后的收款账号');
        const adjustmentConfirmation =
            mode === 'ADJUST'
                ? await requestConfirmation({
                      title: '确认人工调整返利余额？',
                      description: `将为${customer.name || customer.email}调整 ${formatMoney(money, effectiveCurrency)}，该操作会永久写入财务审计流水。`,
                      confirmLabel: '验证并调整',
                      tone: 'warning',
                      requireCurrentPassword: true,
                  })
                : null;
        if (mode === 'ADJUST' && !adjustmentConfirmation) return;
        const adjustmentContext = adjustmentConfirmation
            ? sensitiveActionContext(adjustmentConfirmation.currentPassword ?? '')
            : undefined;
        try {
            if (mode === 'WITHDRAW')
                await createWithdrawal({
                    variables: {
                        input: {
                            customerId: customer.id,
                            currencyCode: effectiveCurrency,
                            amount: money,
                            payoutMethod: method,
                            payoutAccountMasked: account.trim(),
                            note: reason.trim(),
                        },
                    },
                });
            else
                await adjust({
                    variables: {
                        customerId: customer.id,
                        currencyCode: effectiveCurrency,
                        amount: money,
                        reason: reason.trim(),
                    },
                    context: adjustmentContext,
                });
            await onSaved(
                mode === 'WITHDRAW' ? '人工提款申请已创建并冻结对应余额' : '人工余额调整已完成并写入审计流水',
            );
        } catch (error) {
            onError(errorText(error));
        }
    };
    if (!customer && lookup.error)
        return (
            <Modal title={dialogTitle} description={dialogDescription} onClose={onClose}>
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-center" role="alert">
                    <AlertCircle className="mx-auto h-7 w-7 text-rose-500" />
                    <p className="mt-2 text-xs text-rose-700">
                        {toUserFacingError(lookup.error, '客户列表读取失败，请重新加载。')}
                    </p>
                    <button
                        type="button"
                        onClick={() => void lookup.refetch()}
                        className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white"
                    >
                        重新加载客户
                    </button>
                </div>
            </Modal>
        );
    if (customer && wallets.loading && !wallets.data)
        return (
            <Modal title={dialogTitle} description={dialogDescription} onClose={onClose}>
                <LoadingState />
            </Modal>
        );
    if (customer && wallets.error)
        return (
            <Modal title={dialogTitle} description={dialogDescription} onClose={onClose}>
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-center" role="alert">
                    <AlertCircle className="mx-auto h-7 w-7 text-rose-500" />
                    <p className="mt-2 text-xs text-rose-700">
                        {toUserFacingError(wallets.error, '客户返利余额读取失败，请重新加载。')}
                    </p>
                    <button
                        type="button"
                        onClick={() => void wallets.refetch()}
                        className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white"
                    >
                        重新加载余额
                    </button>
                </div>
            </Modal>
        );
    return (
        <Modal
            title={mode === 'WITHDRAW' ? '代客户发起人工提款' : '人工调整返利余额'}
            description={
                mode === 'WITHDRAW'
                    ? '创建后从可用余额转入冻结余额，仍需后续审批与打款登记。'
                    : '支持正负调整，必须填写业务原因，操作会永久写入审计流水。'
            }
            onClose={onClose}
        >
            {!customer ? (
                <>
                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                        <input
                            value={search}
                            onChange={event => setSearch(event.target.value)}
                            aria-label="搜索客户"
                            placeholder="搜索客户姓名、手机号或邮箱"
                            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-xs"
                        />
                    </div>
                    <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                        {lookup.loading && !lookup.data ? (
                            <LoadingState />
                        ) : (
                            lookup.data?.customers.items.map(item => (
                                <button
                                    type="button"
                                    key={item.id}
                                    onClick={() =>
                                        setCustomer({
                                            id: item.id,
                                            name: `${item.lastName}${item.firstName}` || item.emailAddress,
                                            email: item.emailAddress,
                                        })
                                    }
                                    className="flex w-full items-center justify-between rounded-lg border border-slate-200 p-3 text-left hover:border-blue-300"
                                >
                                    <NameEmail
                                        name={`${item.lastName}${item.firstName}` || item.emailAddress}
                                        email={item.phoneNumber || item.emailAddress}
                                    />
                                    <ChevronRight className="h-4 w-4 text-slate-400" />
                                </button>
                            ))
                        )}
                    </div>
                    {lookup.data && (
                        <p className="mt-2 text-[10px] text-slate-400">
                            匹配 {lookup.data.customers.totalItems} 位客户，当前显示前 20
                            位；继续输入可缩小范围
                        </p>
                    )}
                </>
            ) : (
                <>
                    <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3">
                        <NameEmail name={customer.name} email={customer.email} />
                        <button
                            type="button"
                            onClick={() => setCustomer(null)}
                            className="text-[11px] font-bold text-blue-600"
                        >
                            更换客户
                        </button>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                        {wallets.data?.referralCustomerWallets.map(wallet => (
                            <div
                                key={wallet.id}
                                className="col-span-3 grid grid-cols-3 rounded-lg border border-slate-200 p-3 text-center text-[10px]"
                            >
                                <SmallMetric
                                    label={`${wallet.currencyCode} 可用`}
                                    value={formatMoney(wallet.availableBalance, wallet.currencyCode)}
                                />
                                <SmallMetric
                                    label="待生效"
                                    value={formatMoney(wallet.pendingBalance, wallet.currencyCode)}
                                />
                                <SmallMetric
                                    label="冻结"
                                    value={formatMoney(wallet.reservedBalance, wallet.currencyCode)}
                                />
                            </div>
                        ))}
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <FormSelect
                            label="币种"
                            value={effectiveCurrency}
                            onChange={setCurrency}
                            options={
                                wallets.data?.referralCustomerWallets.length
                                    ? wallets.data.referralCustomerWallets.map(wallet => [
                                          wallet.currencyCode,
                                          wallet.currencyCode,
                                      ])
                                    : [[defaultCurrency, defaultCurrency]]
                            }
                        />
                        <TextField
                            label={mode === 'ADJUST' ? '调整金额（正数增加，负数扣减）*' : '提款金额 *'}
                            type="number"
                            value={amount}
                            onChange={setAmount}
                        />
                        {mode === 'WITHDRAW' && (
                            <>
                                <FormSelect
                                    label="提款方式"
                                    value={method}
                                    onChange={setMethod}
                                    options={[
                                        ['ALIPAY', '支付宝'],
                                        ['BANK', '银行卡'],
                                        ['USDT_TRC20', 'USDT-TRC20'],
                                    ]}
                                />
                                <TextField
                                    label="脱敏收款账号 *"
                                    value={account}
                                    onChange={setAccount}
                                    placeholder="例如 138****0000 / TAbc…xyz"
                                />
                            </>
                        )}
                    </div>
                    <label className="mt-3 block text-[11px] font-bold text-slate-600">
                        {mode === 'ADJUST' ? '调整原因 *' : '客服处理备注 *'}
                        <textarea
                            value={reason}
                            onChange={event => setReason(event.target.value)}
                            rows={3}
                            className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-xs font-normal"
                        />
                    </label>
                    <ModalFooter
                        onCancel={onClose}
                        onConfirm={() => void submit()}
                        pending={withdrawalState.loading || adjustState.loading}
                        disabled={!amount || !reason.trim() || (mode === 'WITHDRAW' && !account.trim())}
                        confirmLabel={mode === 'WITHDRAW' ? '创建提款申请' : '确认调整余额'}
                        danger={mode === 'ADJUST'}
                    />
                </>
            )}
        </Modal>
    );
}

export function PosterEditor({
    source,
    programUpdatedAt,
    rewardRate,
    onClose,
    onSaved,
    onError,
    error,
}: {
    source: ReferralPosterRecord | 'NEW';
    programUpdatedAt: string;
    rewardRate: number;
    onClose: () => void;
    onSaved: (message: string) => Promise<void>;
    onError: (message: string) => void;
    error?: string;
}) {
    const { hasAnyPermission } = useAdminPermissions();
    const canReadAssets = hasAnyPermission(['ReadAsset', 'ReadCatalog']);
    const [expectedUpdatedAt] = useState(programUpdatedAt);
    const [originalDraft] = useState(() => posterDraft(source));
    const [draft, setDraft] = useState<PosterDraft>(() => posterDraft(source));
    const [assetSearch, setAssetSearch] = useState('');
    const [previewValidation, setPreviewValidation] = useState({ pending: true, error: '' });
    const [knownAssets, setKnownAssets] = useState<PosterAssetChoice[]>(() => {
        if (source === 'NEW') return [];
        const selected: PosterAssetChoice[] = [];
        if (source.posterBackgroundAsset) selected.push(source.posterBackgroundAsset);
        if (
            source.shareBackgroundAsset &&
            !selected.some(asset => asset.id === source.shareBackgroundAsset?.id)
        ) {
            selected.push(source.shareBackgroundAsset);
        }
        return selected;
    });
    const deferredAssetSearch = useDeferredValue(assetSearch.trim());
    const assetQuery = useQuery<PosterAssetLookupResult>(GET_ASSETS, {
        skip: !canReadAssets,
        variables: {
            options: {
                take: 30,
                sort: { updatedAt: 'DESC', id: 'DESC' },
                filter: {
                    type: { eq: 'IMAGE' },
                    ...(deferredAssetSearch ? { name: { contains: deferredAssetSearch } } : {}),
                },
            },
        },
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
    });
    const [create, createState] = useMutation(CREATE_REFERRAL_POSTER_MUTATION);
    const [update, updateState] = useMutation(UPDATE_REFERRAL_POSTER_MUTATION);
    const assets = [
        ...new Map(
            [...knownAssets, ...(assetQuery.data?.assets.items ?? [])].map(asset => [asset.id, asset]),
        ).values(),
    ];
    const selectAsset = (field: 'posterBackgroundAssetId' | 'shareBackgroundAssetId', assetId: string) => {
        const selected = assets.find(asset => asset.id === assetId);
        if (selected && !knownAssets.some(asset => asset.id === selected.id)) {
            setKnownAssets(current => [...current, selected]);
        }
        setDraft(current => ({ ...current, [field]: assetId }));
    };
    const validation = posterDraftError(draft);
    const submit = async () => {
        if (createState.loading || updateState.loading) return;
        if (validation || previewValidation.pending || previewValidation.error)
            return onError(validation || previewValidation.error || '请等待中英文排版检查');
        const input = {
            ...omitUnchangedEnglish(draft, originalDraft),
            posterBackgroundAssetId: draft.posterBackgroundAssetId || null,
            shareBackgroundAssetId: draft.shareBackgroundAssetId || null,
        };
        try {
            if (draft.id) {
                const { enabled: _enabled, ...contentInput } = input;
                await update({ variables: { input: { ...contentInput, expectedUpdatedAt } } });
            } else {
                const { id: _id, ...createInput } = input;
                await create({ variables: { input: createInput } });
            }
            await onSaved('中文海报已保存，英文待同步');
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <Modal
            title={draft.id ? '编辑分享海报模板' : '新建分享海报模板'}
            description="按固定区域编辑中英文文案。店名、网址、二维码自动读取当前店铺；奖励比例使用 {rewardRate}。背景请使用无字的 1080×1920 图片。"
            onClose={onClose}
        >
            {error && (
                <p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
                    {error}
                </p>
            )}
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_260px]">
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                    <h3 className="sm:col-span-2 text-xs font-bold text-slate-700">
                        01 · 基本信息与背景{' '}
                        <FeatureHelpButton topic="marketing.poster-templates" title="海报基本信息与背景" />
                    </h3>
                    <TextField
                        label="模板名称 *"
                        value={draft.name}
                        onChange={name => setDraft({ ...draft, name })}
                    />
                    <TextField
                        label="排序"
                        type="number"
                        value={String(draft.position)}
                        onChange={value => setDraft({ ...draft, position: Number(value) })}
                    />
                    <div className="sm:col-span-2">
                        <TextField
                            label="搜索全部图片素材"
                            value={assetSearch}
                            onChange={setAssetSearch}
                            placeholder="输入素材名称"
                        />
                        <div className="mt-1 flex min-h-4 items-center justify-between gap-3 text-[10px] text-slate-400">
                            {assetQuery.loading ? (
                                <span className="flex items-center gap-1" role="status">
                                    <LoaderCircle className="h-3 w-3 animate-spin" />
                                    正在查询素材库…
                                </span>
                            ) : assetQuery.error ? (
                                <span className="text-rose-600" role="alert">
                                    素材读取失败，请重试
                                </span>
                            ) : (
                                <span>
                                    匹配 {assetQuery.data?.assets.totalItems ?? 0} 张图片，当前显示前 30 张
                                </span>
                            )}
                            {assetQuery.error && (
                                <button
                                    type="button"
                                    onClick={() => void assetQuery.refetch()}
                                    className="font-bold text-blue-600 hover:text-blue-700"
                                >
                                    重新加载
                                </button>
                            )}
                        </div>
                    </div>
                    <FormSelect
                        label="海报背景图"
                        value={draft.posterBackgroundAssetId}
                        onChange={posterBackgroundAssetId =>
                            selectAsset('posterBackgroundAssetId', posterBackgroundAssetId)
                        }
                        options={[['', '不使用图片'], ...assets.map(asset => [asset.id, asset.name])]}
                    />
                    <FormSelect
                        label="分享背景图"
                        value={draft.shareBackgroundAssetId}
                        onChange={shareBackgroundAssetId =>
                            selectAsset('shareBackgroundAssetId', shareBackgroundAssetId)
                        }
                        options={[['', '不使用图片'], ...assets.map(asset => [asset.id, asset.name])]}
                    />
                    {posterLayoutFields
                        .filter(field => field.field.endsWith('Zh'))
                        .flatMap(field => {
                            const groups: Partial<Record<string, string>> = {
                                tag: '02 · 主标题与介绍',
                                feature1: '03 · 服务卖点',
                                qrlabel: '04 · 扫码与邀请奖励',
                                scene1: '05 · 场景标签',
                                cta: '06 · 行动引导与页脚',
                            };
                            return [
                                groups[field.id] ? (
                                    <h3
                                        key={`group-${field.id}`}
                                        className="sm:col-span-2 border-t border-slate-200 pt-4 text-xs font-bold text-slate-700"
                                    >
                                        {groups[field.id]}
                                        <FeatureHelpButton
                                            topic="marketing.poster-templates"
                                            title={groups[field.id]!}
                                        />
                                    </h3>
                                ) : null,
                                ...(['Zh', 'En'] as const).map(locale => {
                                    const key = field.field.replace(/Zh$/, locale) as PosterCopyField;
                                    return (
                                        <label
                                            key={key}
                                            className="block text-[11px] font-bold text-slate-600"
                                        >
                                            {field.label} · {locale === 'Zh' ? '中文' : 'English'}（最多{' '}
                                            {field.lines} 行）
                                            <textarea
                                                value={draft[key]}
                                                rows={field.lines}
                                                onChange={event =>
                                                    setDraft(current => ({
                                                        ...current,
                                                        [key]: event.target.value,
                                                    }))
                                                }
                                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-900"
                                            />
                                        </label>
                                    );
                                }),
                            ];
                        })}
                    <h3 className="sm:col-span-2 border-t border-slate-200 pt-4 text-xs font-bold text-slate-700">
                        07 · 样式与显示
                        <FeatureHelpButton topic="marketing.poster-templates" title="海报样式与显示" />
                    </h3>
                    <details className="sm:col-span-2 text-xs text-slate-500">
                        <summary>历史服务说明字段（保留兼容，不占用卖点区）</summary>
                        <TextField
                            label="中文服务说明"
                            value={draft.serviceTextZh}
                            onChange={serviceTextZh => setDraft({ ...draft, serviceTextZh })}
                        />
                        <TextField
                            label="English service text"
                            value={draft.serviceTextEn}
                            onChange={serviceTextEn => setDraft({ ...draft, serviceTextEn })}
                        />
                    </details>
                    <TextField
                        label="前景色"
                        type="color"
                        value={draft.foregroundColor}
                        onChange={foregroundColor => setDraft({ ...draft, foregroundColor })}
                    />
                    <TextField
                        label="强调色"
                        type="color"
                        value={draft.accentColor}
                        onChange={accentColor => setDraft({ ...draft, accentColor })}
                    />
                    <NumberField
                        label="遮罩透明度 (%)"
                        value={draft.overlayOpacity}
                        min={0}
                        max={80}
                        step={1}
                        onChange={overlayOpacity => setDraft({ ...draft, overlayOpacity })}
                    />
                    {!draft.id && (
                        <ToggleField
                            label="启用模板"
                            detail="停用后客户端不会提供该模板。"
                            checked={draft.enabled}
                            onChange={enabled => setDraft({ ...draft, enabled })}
                        />
                    )}
                </div>
                <aside className="min-w-0 md:sticky md:top-0 md:self-start">
                    <ReferralPosterPreview
                        draft={draft}
                        assets={assets}
                        rewardRate={rewardRate}
                        onValidation={setPreviewValidation}
                    />
                </aside>
            </div>
            {validation && <p className="mt-3 text-xs text-rose-600">{validation}</p>}
            <ModalFooter
                onCancel={onClose}
                onConfirm={() => void submit()}
                pending={createState.loading || updateState.loading}
                disabled={Boolean(validation || previewValidation.error || previewValidation.pending)}
                confirmLabel="保存海报模板"
            />
        </Modal>
    );
}
