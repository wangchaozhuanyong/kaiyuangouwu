import { useMutation, useQuery } from '@apollo/client/react';
import { Edit3, Plus, RefreshCw, Save, Settings2, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { sensitiveActionContext } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { SensitiveActionDialog } from '../../components/SensitiveActionDialog';
import {
    CREATE_GENERIC_PROMOTION_MUTATION,
    DELETE_GENERIC_PROMOTION_MUTATION,
    GENERIC_PROMOTION_DETAIL_QUERY,
    GENERIC_PROMOTIONS_QUERY,
    UPDATE_GENERIC_PROMOTION_MUTATION,
    type GenericPromotionDetailData,
    type GenericPromotionListRecord,
    type GenericPromotionsData,
    type OperationArgDefinition,
    type OperationDefinition,
    type OperationValue,
} from '../../graphql/generic-promotions.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatDateTime, getMutationError } from '../Sales/sales-utils';

interface PromotionDraft {
    id?: string;
    name: string;
    description: string;
    enabled: boolean;
    couponCode: string;
    startsAt: string;
    endsAt: string;
    usageLimit: string;
    perCustomerUsageLimit: string;
    conditions: OperationValue[];
    actions: OperationValue[];
}
const emptyDraft = (): PromotionDraft => ({
    name: '',
    description: '',
    enabled: true,
    couponCode: '',
    startsAt: '',
    endsAt: '',
    usageLimit: '',
    perCustomerUsageLimit: '',
    conditions: [],
    actions: [],
});

export function GenericPromotionsPanel() {
    const query = useQuery<GenericPromotionsData>(GENERIC_PROMOTIONS_QUERY, {
        variables: { options: { take: 100, sort: { createdAt: 'DESC' } } },
        fetchPolicy: 'cache-and-network',
    });
    const [editingId, setEditingId] = useState<string | 'new' | null>(null);
    const [deleting, setDeleting] = useState<GenericPromotionListRecord | null>(null);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const [deletePromotion, deleteState] = useMutation<{
        deletePromotion: { result: string; message?: string | null };
    }>(DELETE_GENERIC_PROMOTION_MUTATION);
    const remove = async (password: string) => {
        if (!deleting) return;
        setError('');
        try {
            const response = await deletePromotion({
                variables: { id: deleting.id },
                context: sensitiveActionContext(password),
            });
            const result = response.data?.deletePromotion;
            if (result?.result !== 'DELETED') throw new Error(result?.message || '后端拒绝删除促销');
            setNotice(`通用促销「${deleting.name}」已删除`);
            setDeleting(null);
            await query.refetch();
        } catch (cause) {
            setError(toUserFacingError(cause, '促销删除失败'));
        }
    };
    if (query.loading && !query.data) return <State label="正在读取 Vendure 通用促销…" />;
    if (query.error || !query.data)
        return <State tone="error" label="通用促销加载失败" action={() => void query.refetch()} />;
    return (
        <div className="space-y-4">
            {notice && <Notice tone="success" message={notice} />}
            {error && !deleting && <Notice tone="error" message={error} />}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                            <Settings2 className="h-4 w-4 text-violet-600" />
                            Vendure 通用促销
                            <FeatureHelpButton
                                topic="marketing.generic-promotions"
                                title="Vendure 通用促销"
                            />
                        </h2>
                        <p className="mt-1 text-xs text-slate-500">
                            直接编辑当前服务端已注册的任意 PromotionCondition 和
                            PromotionAction，不限制为优惠券或秒杀模板。
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => void query.refetch()}
                            className={secondaryButton}
                        >
                            <RefreshCw className="h-4 w-4" />
                            刷新
                        </button>
                        <button type="button" onClick={() => setEditingId('new')} className={primaryButton}>
                            <Plus className="h-4 w-4" />
                            新建通用促销
                        </button>
                    </div>
                </div>
                <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200">
                    <table className="min-w-[920px] w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-500">
                            <tr>
                                {[
                                    '名称',
                                    '状态',
                                    '优惠码',
                                    '时间范围',
                                    '用量限制',
                                    '条件 / 动作',
                                    '操作',
                                ].map(label => (
                                    <th key={label} className="px-3 py-2.5 font-bold">
                                        {label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {query.data.promotions.items.map(item => (
                                <tr key={item.id}>
                                    <td className="px-3 py-3">
                                        <strong>{item.name}</strong>
                                        <small className="mt-1 block max-w-64 truncate text-slate-500">
                                            {item.description || '无描述'}
                                        </small>
                                    </td>
                                    <td className="px-3 py-3">{item.enabled ? '启用' : '停用'}</td>
                                    <td className="px-3 py-3 font-mono">{item.couponCode ?? '—'}</td>
                                    <td className="px-3 py-3">{dateRange(item)}</td>
                                    <td className="px-3 py-3">
                                        总 {item.usageLimit ?? '∞'} · 每客 {item.perCustomerUsageLimit ?? '∞'}
                                    </td>
                                    <td className="px-3 py-3 text-slate-500">进入编辑器查看</td>
                                    <td className="px-3 py-3">
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setEditingId(item.id)}
                                                className="inline-flex items-center gap-1 font-bold text-blue-600"
                                            >
                                                <Edit3 className="h-3.5 w-3.5" />
                                                编辑
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setDeleting(item)}
                                                className="inline-flex items-center gap-1 font-bold text-rose-600"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                                删除
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!query.data.promotions.items.length && (
                        <p className="p-8 text-center text-xs text-slate-500">暂无通用促销</p>
                    )}
                </div>
            </section>
            {editingId && (
                <PromotionEditor
                    id={editingId}
                    conditions={query.data.promotionConditions}
                    actions={query.data.promotionActions}
                    languageCode={query.data.activeChannel.defaultLanguageCode}
                    onClose={() => setEditingId(null)}
                    onSaved={async message => {
                        setEditingId(null);
                        setNotice(message);
                        setError('');
                        await query.refetch();
                    }}
                    onError={setError}
                />
            )}
            <SensitiveActionDialog
                open={deleting !== null}
                title="删除通用促销"
                description={`将删除「${deleting?.name ?? ''}」。后端会拒绝不允许删除的活动，并校验当前管理员密码。`}
                confirmLabel="验证并删除"
                loading={deleteState.loading}
                error={error}
                onClose={() => {
                    if (!deleteState.loading) {
                        setDeleting(null);
                        setError('');
                    }
                }}
                onConfirm={remove}
            />
        </div>
    );
}

export function PromotionEditor({
    id,
    conditions,
    actions,
    languageCode,
    onClose,
    onSaved,
    onError,
}: {
    id: string | 'new';
    conditions: OperationDefinition[];
    actions: OperationDefinition[];
    languageCode: string;
    onClose: () => void;
    onSaved: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const detail = useQuery<GenericPromotionDetailData>(GENERIC_PROMOTION_DETAIL_QUERY, {
        variables: { id },
        skip: id === 'new',
        fetchPolicy: 'network-only',
    });
    const [draft, setDraft] = useState<PromotionDraft>(emptyDraft);
    const [createPromotion, createState] = useMutation(CREATE_GENERIC_PROMOTION_MUTATION);
    const [updatePromotion, updateState] = useMutation(UPDATE_GENERIC_PROMOTION_MUTATION);
    /* oxlint-disable react/set-state-in-effect -- the selected promotion response initializes the editor draft. */
    useEffect(() => {
        if (detail.data?.promotion) setDraft(detailToDraft(detail.data.promotion));
    }, [detail.data?.promotion]);
    /* oxlint-enable react/set-state-in-effect */
    const isDraftInitializing =
        id !== 'new' &&
        (detail.loading || Boolean(detail.data?.promotion && draft.id !== detail.data.promotion.id));
    const save = async () => {
        try {
            const input = promotionInput(draft, languageCode, conditions, actions);
            const response =
                id === 'new'
                    ? await createPromotion({ variables: { input } })
                    : await updatePromotion({ variables: { input: { ...input, id } } });
            const payload =
                id === 'new'
                    ? (
                          response.data as
                              | { createPromotion?: { __typename?: string; id?: string; message?: string } }
                              | undefined
                      )?.createPromotion
                    : (
                          response.data as
                              | { updatePromotion?: { __typename?: string; id?: string; message?: string } }
                              | undefined
                      )?.updatePromotion;
            if (payload?.__typename !== 'Promotion' || !payload.id)
                throw new Error(getMutationError(payload));
            await onSaved(id === 'new' ? '通用促销已创建' : '通用促销已更新');
        } catch (cause) {
            onError(toUserFacingError(cause, '通用促销保存失败'));
        }
    };
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
            <AccessibleDialogSurface
                accessibleName={id === 'new' ? '新建通用促销' : '编辑通用促销'}
                onRequestClose={onClose}
                className="flex h-[94vh] max-h-[64rem] w-full max-w-5xl flex-col rounded-2xl bg-white shadow-2xl"
            >
                <div className="flex items-center justify-between border-b p-5">
                    <div>
                        <h2 className="text-base font-bold">
                            {id === 'new' ? '新建通用促销' : '编辑通用促销'}
                        </h2>
                        <p className="mt-1 text-xs text-slate-500">
                            参数值按服务端 ConfigArgDefinition 类型提交；列表参数需填写 JSON 数组。
                        </p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="关闭">
                        <X className="h-4 w-4" />
                    </button>
                </div>
                {detail.error ? (
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        <State tone="error" label="促销详情加载失败" action={() => void detail.refetch()} />
                    </div>
                ) : isDraftInitializing ? (
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        <State label="正在读取促销规则…" />
                    </div>
                ) : (
                    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            <TextField
                                label="名称 *"
                                value={draft.name}
                                onChange={name => setDraft({ ...draft, name })}
                            />
                            <TextField
                                label="优惠码"
                                value={draft.couponCode}
                                onChange={couponCode => setDraft({ ...draft, couponCode })}
                            />
                            <Toggle
                                label="启用促销"
                                checked={draft.enabled}
                                onChange={enabled => setDraft({ ...draft, enabled })}
                            />
                            <TextField
                                label="开始时间"
                                type="datetime-local"
                                value={draft.startsAt}
                                onChange={startsAt => setDraft({ ...draft, startsAt })}
                            />
                            <TextField
                                label="结束时间"
                                type="datetime-local"
                                value={draft.endsAt}
                                onChange={endsAt => setDraft({ ...draft, endsAt })}
                            />
                            <TextField
                                label="总使用次数"
                                type="number"
                                value={draft.usageLimit}
                                onChange={usageLimit => setDraft({ ...draft, usageLimit })}
                            />
                            <TextField
                                label="每客户次数"
                                type="number"
                                value={draft.perCustomerUsageLimit}
                                onChange={perCustomerUsageLimit =>
                                    setDraft({ ...draft, perCustomerUsageLimit })
                                }
                            />
                            <div className="sm:col-span-2 lg:col-span-2">
                                <TextField
                                    label="描述"
                                    value={draft.description}
                                    onChange={description => setDraft({ ...draft, description })}
                                />
                            </div>
                        </div>
                        <OperationList
                            title="生效条件"
                            values={draft.conditions}
                            definitions={conditions}
                            onChange={next => setDraft({ ...draft, conditions: next })}
                        />
                        <OperationList
                            title="促销动作"
                            values={draft.actions}
                            definitions={actions}
                            onChange={next => setDraft({ ...draft, actions: next })}
                        />
                    </div>
                )}
                <div className="flex justify-end gap-2 border-t p-5">
                    <button type="button" onClick={onClose} className={secondaryButton}>
                        取消
                    </button>
                    <button
                        type="button"
                        onClick={() => void save()}
                        disabled={
                            createState.loading ||
                            updateState.loading ||
                            isDraftInitializing ||
                            (id !== 'new' && !detail.data?.promotion)
                        }
                        className={primaryButton}
                    >
                        <Save className="h-4 w-4" />
                        {createState.loading || updateState.loading ? '保存中…' : '保存促销'}
                    </button>
                </div>
            </AccessibleDialogSurface>
        </div>
    );
}

function OperationList({
    title,
    values,
    definitions,
    onChange,
}: {
    title: string;
    values: OperationValue[];
    definitions: OperationDefinition[];
    onChange: (next: OperationValue[]) => void;
}) {
    const [selected, setSelected] = useState(definitions[0]?.code ?? '');
    const add = () => {
        const definition = definitions.find(item => item.code === selected);
        if (!definition) return;
        onChange([
            ...values,
            {
                code: definition.code,
                arguments: definition.args.map(arg => ({ name: arg.name, value: defaultArgValue(arg) })),
            },
        ]);
    };
    return (
        <section className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-sm font-bold text-slate-900">
                    {title} ({values.length})
                </h3>
                <div className="flex gap-2">
                    <select
                        value={selected}
                        onChange={event => setSelected(event.target.value)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                    >
                        <option value="">请选择</option>
                        {definitions.map(item => (
                            <option key={item.code} value={item.code}>
                                {item.description || item.code}
                            </option>
                        ))}
                    </select>
                    <button type="button" onClick={add} disabled={!selected} className={secondaryButton}>
                        <Plus className="h-3.5 w-3.5" />
                        添加
                    </button>
                </div>
            </div>
            <div className="mt-3 space-y-3">
                {values.map((operation, index) => {
                    const definition = definitions.find(item => item.code === operation.code);
                    return (
                        <article key={`${operation.code}-${index}`} className="rounded-lg bg-slate-50 p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <strong className="text-xs">
                                        {definition?.description || operation.code}
                                    </strong>
                                    <span className="ml-2 font-mono text-[10px] text-slate-500">
                                        {operation.code}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() =>
                                        onChange(values.filter((_, itemIndex) => itemIndex !== index))
                                    }
                                    aria-label={`删除 ${operation.code}`}
                                    className="text-rose-600"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                {(
                                    definition?.args ??
                                    operation.arguments.map(arg => ({
                                        name: arg.name,
                                        type: 'string',
                                        required: false,
                                        list: false,
                                        defaultValue: null,
                                        label: null,
                                        description: null,
                                        ui: null,
                                    }))
                                ).map(arg => (
                                    <OperationArg
                                        key={arg.name}
                                        definition={arg}
                                        value={
                                            operation.arguments.find(item => item.name === arg.name)?.value ??
                                            ''
                                        }
                                        onChange={value =>
                                            onChange(
                                                values.map((item, itemIndex) =>
                                                    itemIndex === index
                                                        ? {
                                                              ...item,
                                                              arguments: updateArgument(
                                                                  item.arguments,
                                                                  arg.name,
                                                                  value,
                                                              ),
                                                          }
                                                        : item,
                                                ),
                                            )
                                        }
                                    />
                                ))}
                            </div>
                        </article>
                    );
                })}
                {!values.length && (
                    <p className="rounded-lg border border-dashed p-5 text-center text-xs text-slate-500">
                        尚未添加
                    </p>
                )}
            </div>
        </section>
    );
}
function OperationArg({
    definition,
    value,
    onChange,
}: {
    definition: OperationArgDefinition;
    value: string;
    onChange: (value: string) => void;
}) {
    const label = definition.label || definition.name;
    if (definition.type === 'boolean' && !definition.list)
        return (
            <label className={labelClass}>
                {label}
                {definition.required ? ' *' : ''}
                <select value={value} onChange={event => onChange(event.target.value)} className={inputClass}>
                    <option value="true">true</option>
                    <option value="false">false</option>
                </select>
                <small className="mt-1 block font-normal text-slate-400">{definition.description}</small>
            </label>
        );
    return (
        <label className={labelClass}>
            {label}
            {definition.required ? ' *' : ''}
            <input
                value={value}
                onChange={event => onChange(event.target.value)}
                placeholder={definition.list ? '["id-1", "id-2"]' : definition.type}
                className={`${inputClass} ${definition.list ? 'font-mono' : ''}`}
            />
            <small className="mt-1 block font-normal text-slate-400">
                {definition.description}
                {definition.list ? ' · JSON 数组' : ''}
            </small>
        </label>
    );
}
function promotionInput(
    draft: PromotionDraft,
    languageCode: string,
    conditionDefs: OperationDefinition[],
    actionDefs: OperationDefinition[],
) {
    const name = required(draft.name, '名称');
    if (!draft.couponCode.trim() && !draft.conditions.length)
        throw new Error('无优惠码时至少需要一个生效条件');
    if (!draft.actions.length) throw new Error('至少需要一个促销动作');
    if (draft.startsAt && draft.endsAt && new Date(draft.endsAt) <= new Date(draft.startsAt))
        throw new Error('结束时间必须晚于开始时间');
    return {
        enabled: draft.enabled,
        startsAt: dateOrNull(draft.startsAt),
        endsAt: dateOrNull(draft.endsAt),
        couponCode: draft.couponCode.trim() || null,
        usageLimit: integerOrNull(draft.usageLimit, '总使用次数'),
        perCustomerUsageLimit: integerOrNull(draft.perCustomerUsageLimit, '每客户次数'),
        conditions: validateOperations(draft.conditions, conditionDefs),
        actions: validateOperations(draft.actions, actionDefs),
        translations: [{ languageCode, name, description: draft.description.trim() }],
    };
}
function validateOperations(values: OperationValue[], definitions: OperationDefinition[]) {
    return values.map(operation => {
        const definition = definitions.find(item => item.code === operation.code);
        if (!definition) throw new Error(`服务端未注册操作 ${operation.code}`);
        const args = definition.args.map(arg => {
            const value = operation.arguments.find(item => item.name === arg.name)?.value.trim() ?? '';
            if (arg.required && value === '')
                throw new Error(`${definition.description} 的 ${arg.label || arg.name} 不能为空`);
            if (arg.list && value) {
                const parsed = JSON.parse(value);
                if (!Array.isArray(parsed)) throw new Error(`${arg.label || arg.name} 必须是 JSON 数组`);
            }
            if (
                ['int', 'float', 'money'].includes(arg.type.toLowerCase()) &&
                value &&
                !Number.isFinite(Number(value))
            )
                throw new Error(`${arg.label || arg.name} 必须是数字`);
            return { name: arg.name, value };
        });
        return { code: operation.code, arguments: args };
    });
}
function detailToDraft(value: NonNullable<GenericPromotionDetailData['promotion']>): PromotionDraft {
    const translation = value.translations[0];
    return {
        id: value.id,
        name: translation?.name ?? value.name,
        description: translation?.description ?? value.description,
        enabled: value.enabled,
        couponCode: value.couponCode ?? '',
        startsAt: dateInput(value.startsAt),
        endsAt: dateInput(value.endsAt),
        usageLimit: value.usageLimit == null ? '' : String(value.usageLimit),
        perCustomerUsageLimit: value.perCustomerUsageLimit == null ? '' : String(value.perCustomerUsageLimit),
        conditions: value.conditions.map(operation => ({ code: operation.code, arguments: operation.args })),
        actions: value.actions.map(operation => ({ code: operation.code, arguments: operation.args })),
    };
}
function updateArgument(args: OperationValue['arguments'], name: string, value: string) {
    return args.some(arg => arg.name === name)
        ? args.map(arg => (arg.name === name ? { ...arg, value } : arg))
        : [...args, { name, value }];
}
function defaultArgValue(arg: OperationArgDefinition) {
    if (arg.defaultValue == null) return arg.type === 'boolean' ? 'false' : arg.list ? '[]' : '';
    return typeof arg.defaultValue === 'string' ? arg.defaultValue : JSON.stringify(arg.defaultValue);
}
function dateRange(value: GenericPromotionListRecord) {
    return `${value.startsAt ? formatDateTime(value.startsAt) : '即时'} → ${value.endsAt ? formatDateTime(value.endsAt) : '不限'}`;
}
function dateInput(value: string | null) {
    return value ? new Date(value).toISOString().slice(0, 16) : '';
}
function dateOrNull(value: string) {
    return value ? new Date(value).toISOString() : null;
}
function integerOrNull(value: string, label: string) {
    if (!value.trim()) return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label}必须是正整数`);
    return parsed;
}
function required(value: string, label: string) {
    const clean = value.trim();
    if (!clean) throw new Error(`${label}不能为空`);
    return clean;
}
function TextField({
    label,
    value,
    onChange,
    type = 'text',
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    type?: string;
}) {
    return (
        <label className={labelClass}>
            {label}
            <input
                type={type}
                min={type === 'number' ? 1 : undefined}
                value={value}
                onChange={event => onChange(event.target.value)}
                className={inputClass}
            />
        </label>
    );
}
function Toggle({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <label className="flex items-center gap-2 self-end rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-700">
            <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
            {label}
        </label>
    );
}
function Notice({ tone, message }: { tone: 'success' | 'error'; message: string }) {
    return (
        <div
            role={tone === 'error' ? 'alert' : 'status'}
            className={`rounded-lg border p-3 text-xs ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
        >
            {message}
        </div>
    );
}
function State({
    label,
    tone = 'default',
    action,
}: {
    label: string;
    tone?: 'default' | 'error';
    action?: () => void;
}) {
    return (
        <div
            role={tone === 'error' ? 'alert' : 'status'}
            className={`m-5 rounded-xl border p-8 text-center text-sm ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white text-slate-500'}`}
        >
            <p>{label}</p>
            {action && (
                <button
                    type="button"
                    onClick={action}
                    className="mt-3 rounded-lg border px-3 py-2 text-xs font-bold"
                >
                    重试
                </button>
            )}
        </div>
    );
}
const labelClass = 'text-xs font-bold text-slate-600';
const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal';
const primaryButton =
    'inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40';
const secondaryButton =
    'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40';
