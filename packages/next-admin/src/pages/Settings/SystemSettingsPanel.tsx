import { useMutation } from '@apollo/client/react';
import { ChevronRight, LoaderCircle, Settings2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { AdminButton, AdminSelect, AdminTextArea } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { AdminOverlayPortal } from '../../components/AdminOverlayHost';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { SearchInput } from '../../components/SearchInput';
import { TechnicalDetails } from '../../components/TechnicalDetails';
import {
    SET_SETTINGS_STORE_VALUE_MUTATION,
    type SettingsStoreFieldRecord,
} from '../../graphql/management.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useServerDraft } from '../../hooks/use-server-draft';
import { isPlatformManagementChannel } from '../../layouts/app-shell-navigation';
import { canAccessAdminPath } from '../../utils/admin-permissions';
import { toUserFacingError } from '../../utils/user-facing-error';
import {
    businessSettingsGroups,
    getSettingsPresentation,
    getSettingsScopeLabel,
    getSettingsValueSummary,
    matchesSettingsSearch,
    settingsEditorValue,
} from './system-settings-model';

const secondaryButton =
    'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50';

export function SystemSettingsPanel({
    fields,
    channelCode,
    onChanged,
    onError,
}: {
    fields: SettingsStoreFieldRecord[];
    channelCode?: string;
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const { permissions } = useAdminPermissions();
    const [search, setSearch] = useState('');
    const [scope, setScope] = useState('ALL');
    const [editorKey, setEditorKey] = useState<string | null>(null);
    const editorTrigger = useRef<HTMLButtonElement | null>(null);
    useEffect(() => {
        if (!editorKey) {
            editorTrigger.current?.focus();
            editorTrigger.current = null;
        }
    }, [editorKey]);
    const [save, state] = useMutation<{ setSettingsStoreValue: { result: boolean; error: string | null } }>(
        SET_SETTINGS_STORE_VALUE_MUTATION,
    );
    const storeContext = Boolean(channelCode && !isPlatformManagementChannel(channelCode));
    const visibleFields = storeContext
        ? fields.filter(field => ['CHANNEL', 'USER', 'USER_AND_CHANNEL'].includes(field.scopeType))
        : fields;
    const filtered = visibleFields.filter(
        field => (scope === 'ALL' || field.scopeType === scope) && matchesSettingsSearch(field, search),
    );
    const technical = filtered.filter(field => getSettingsPresentation(field.key).group === 'technical');
    const editor = visibleFields.find(field => field.key === editorKey);
    const update = async (field: SettingsStoreFieldRecord, value: unknown) => {
        if (state.loading || field.readonly || !visibleFields.includes(field)) return;
        try {
            const response = await save({ variables: { input: { key: field.key, value } } });
            const result = response.data?.setSettingsStoreValue;
            if (!result?.result) throw new Error(result?.error || '保存失败');
        } catch (error) {
            onError(toUserFacingError(error, '配置保存失败'));
            return;
        }
        setEditorKey(null);
        try {
            await onChanged(`${getSettingsPresentation(field.key).title}已保存`);
        } catch {
            onError('配置已保存，但最新数据读取失败，请刷新本页。');
        }
    };

    return (
        <div className="space-y-4">
            <section className="rounded-xl bg-white p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                            设置说明与入口
                            <FeatureHelpButton topic="settings.dynamic-config" title="设置说明与入口" />
                        </h2>
                        <p className="mt-2 text-xs leading-5 text-slate-500">
                            日常功能请在对应设置页调整，那里有完整的说明、校验和保存操作。
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                            {storeContext
                                ? '这里只显示当前店铺和当前管理员的配置。'
                                : '这里包含平台配置，修改整个平台的设置会影响全部店铺。'}
                            下方是已保存配置的摘要。“未单独设置”不代表功能关闭，实际生效状态请以对应设置页为准。
                        </p>
                    </div>
                    <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:w-[28rem] lg:shrink-0">
                        <AdminField label="搜索设置">
                            <SearchInput
                                value={search}
                                onValueChange={setSearch}
                                placeholder="名称、用途或配置键"
                                aria-label="搜索设置"
                                className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                            />
                        </AdminField>
                        <AdminField label="适用范围">
                            <AdminSelect
                                value={scope}
                                onChange={event => setScope(event.target.value)}
                                aria-label="配置适用范围"
                                className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                            >
                                <option value="ALL">全部范围</option>
                                {(storeContext
                                    ? (['CHANNEL', 'USER', 'USER_AND_CHANNEL'] as const)
                                    : (['GLOBAL', 'CHANNEL', 'USER', 'USER_AND_CHANNEL', 'CUSTOM'] as const)
                                ).map(value => (
                                    <option key={value} value={value}>
                                        {getSettingsScopeLabel(value)}
                                    </option>
                                ))}
                            </AdminSelect>
                        </AdminField>
                    </div>
                </div>
                <div className="mt-4 divide-y divide-slate-100">
                    {businessSettingsGroups.map(group => {
                        const entries = filtered.filter(
                            field => getSettingsPresentation(field.key).group === group.id,
                        );
                        if (!entries.length) return null;
                        const canOpen = storeContext && canAccessAdminPath(group.path, permissions);
                        return (
                            <article key={group.id} className="py-4">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0">
                                        <h3 className="text-sm font-bold text-slate-900">{group.title}</h3>
                                        <p className="mt-1 text-xs leading-5 text-slate-500">
                                            {group.description}
                                        </p>
                                    </div>
                                    {canOpen && (
                                        <Link className={`${secondaryButton} shrink-0`} to={group.path}>
                                            {group.action}
                                            <ChevronRight className="h-3.5 w-3.5" />
                                        </Link>
                                    )}
                                </div>
                                <p className="mt-2 text-xs leading-5 text-slate-500">
                                    {!storeContext
                                        ? '请先在顶部选择需要管理的经营店铺，再打开：'
                                        : !canOpen
                                          ? '具有对应管理权限的员工可打开：'
                                          : '设置位置：'}
                                    {group.guide}
                                </p>
                                <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
                                    {entries.map(field => (
                                        <div key={field.key} className="min-w-0">
                                            <dt className="text-xs text-slate-600">
                                                {getSettingsPresentation(field.key).title}
                                            </dt>
                                            <dd className="mt-1 text-xs">
                                                <p className="flex flex-wrap items-center gap-2 font-bold text-slate-800">
                                                    {getSettingsValueSummary(field)}
                                                    <span className="font-normal text-slate-400">
                                                        {getSettingsScopeLabel(field.scopeType)}
                                                    </span>
                                                </p>
                                                <p className="mt-1 leading-5 text-slate-500">
                                                    {getSettingsPresentation(field.key).description}
                                                </p>
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                            </article>
                        );
                    })}
                    {!filtered.length && (
                        <p className="py-8 text-center text-xs text-slate-500">
                            {fields.length
                                ? '没有符合条件的设置，请调整搜索或适用范围。'
                                : '当前没有可查看的设置。'}
                        </p>
                    )}
                    {!!filtered.length && filtered.length === technical.length && (
                        <p className="py-4 text-xs text-slate-500">
                            当前条件下只有技术配置，请按需展开下方技术诊断。
                        </p>
                    )}
                </div>
            </section>
            {!!technical.length && (
                <details className="group rounded-xl bg-white" data-settings-diagnostics>
                    <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-bold text-slate-800">
                        <Settings2 className="h-4 w-4" />
                        技术诊断
                        <span className="text-xs font-normal text-slate-500">
                            {technical.length} 项 · 开发维护用
                        </span>
                        <ChevronRight className="ml-auto h-4 w-4 group-open:rotate-90" />
                    </summary>
                    <p className="px-4 pb-3 text-xs leading-5 text-slate-500">
                        运行状态和内部数据由系统维护。高级编辑保留原始数据格式，修改后可能立即影响对应范围。
                    </p>
                    <div className="divide-y divide-slate-100">
                        {technical.map(field => (
                            <article
                                key={field.key}
                                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between"
                            >
                                <div className="min-w-0 flex-1">
                                    <h3 className="text-xs font-bold text-slate-800">
                                        {getSettingsPresentation(field.key).title}
                                    </h3>
                                    <p className="mt-1 text-xs leading-5 text-slate-500">
                                        {getSettingsPresentation(field.key).description}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-600">
                                        {getSettingsValueSummary(field)} ·{' '}
                                        {getSettingsScopeLabel(field.scopeType)} ·{' '}
                                        {field.readonly ? '系统自动维护，只读' : '可高级编辑'}
                                    </p>
                                    <div className="break-all">
                                        <TechnicalDetails
                                            entries={[
                                                { label: '配置键', value: field.key },
                                                {
                                                    label: '原始数据',
                                                    value: settingsEditorValue(field.currentValue),
                                                },
                                            ]}
                                        />
                                    </div>
                                </div>
                                {!field.readonly && (
                                    <AdminButton
                                        type="button"
                                        onClick={event => {
                                            editorTrigger.current = event.currentTarget;
                                            setEditorKey(field.key);
                                        }}
                                        disabled={state.loading}
                                        className={`${secondaryButton} shrink-0`}
                                        aria-label={`高级编辑${getSettingsPresentation(field.key).title}`}
                                    >
                                        高级编辑
                                    </AdminButton>
                                )}
                            </article>
                        ))}
                    </div>
                </details>
            )}
            {editor && !editor.readonly && (
                <SettingsValueEditor
                    field={editor}
                    saving={state.loading}
                    onClose={() => setEditorKey(null)}
                    onSave={value => void update(editor, value)}
                />
            )}
        </div>
    );
}

function SettingsValueEditor({
    field,
    saving,
    onClose,
    onSave,
}: {
    field: SettingsStoreFieldRecord;
    saving: boolean;
    onClose: () => void;
    onSave: (value: unknown) => void;
}) {
    const source = settingsEditorValue(field.currentValue);
    const { draft, setDraft, dirty, sourceChanged, reload } = useServerDraft(field.key, source, source);
    const [error, setError] = useState('');
    const confirm = useConfirmDialog();
    const requestClose = async () => {
        if (saving) return;
        if (
            dirty &&
            !(await confirm({
                title: '放弃未保存的修改？',
                description: '关闭后，本次输入不会保存。',
                confirmLabel: '放弃修改',
                tone: 'danger',
            }))
        )
            return;
        onClose();
    };
    const submit = () => {
        if (saving || sourceChanged) return;
        try {
            onSave(JSON.parse(draft ?? 'null'));
            setError('');
        } catch {
            setError('数据格式不正确。请使用有效的 JSON；文本需加双引号，开关使用 true 或 false。');
        }
    };
    return (
        <AdminOverlayPortal>
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
                <AccessibleDialogSurface
                    accessibleName={`高级编辑${getSettingsPresentation(field.key).title}`}
                    onRequestClose={() => void requestClose()}
                    className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
                >
                    <div className="flex items-start justify-between gap-4">
                        <h2 className="font-bold text-slate-900">
                            高级编辑：{getSettingsPresentation(field.key).title}
                        </h2>
                        <AdminButton
                            type="button"
                            onClick={() => void requestClose()}
                            disabled={saving}
                            aria-label="关闭高级编辑"
                            className="rounded p-1 text-slate-400"
                        >
                            <X className="h-5 w-5" />
                        </AdminButton>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                        适用范围：{getSettingsScopeLabel(field.scopeType)}
                        。按原始数据格式保存；没有专用设置页的内部数据才需要在此维护。
                    </p>
                    <TechnicalDetails entries={[{ label: '配置键', value: field.key }]} />
                    {sourceChanged && (
                        <div role="alert" className="mt-3 text-xs text-amber-700">
                            此配置已被更新。当前输入已保留，请先处理草稿再保存。
                            <AdminButton
                                type="button"
                                disabled={saving}
                                className={`mt-2 ${secondaryButton}`}
                                onClick={async () => {
                                    if (
                                        await confirm({
                                            title: '读取最新配置？',
                                            description: '将放弃当前草稿，并使用最新保存值。',
                                            confirmLabel: '读取最新值',
                                            tone: 'danger',
                                        })
                                    )
                                        reload();
                                }}
                            >
                                放弃草稿并读取最新值
                            </AdminButton>
                        </div>
                    )}
                    <AdminField label="原始配置数据" layout="stacked" className="mt-4">
                        <AdminTextArea
                            rows={10}
                            aria-label="原始配置数据"
                            value={draft ?? ''}
                            onChange={event => setDraft(event.target.value)}
                            disabled={saving}
                            spellCheck={false}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs leading-5"
                        />
                    </AdminField>
                    {error && (
                        <p role="alert" className="mt-2 text-xs text-rose-600">
                            {error}
                        </p>
                    )}
                    <div className="mt-5 flex justify-end gap-2">
                        <AdminButton
                            type="button"
                            onClick={() => void requestClose()}
                            disabled={saving}
                            className={secondaryButton}
                        >
                            取消
                        </AdminButton>
                        <AdminButton
                            type="button"
                            onClick={submit}
                            disabled={saving || sourceChanged || !dirty}
                            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
                        >
                            {saving && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                            {saving ? '正在保存' : '保存配置'}
                        </AdminButton>
                    </div>
                </AccessibleDialogSurface>
            </div>
        </AdminOverlayPortal>
    );
}
