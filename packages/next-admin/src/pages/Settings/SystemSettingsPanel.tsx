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
import { APP_SHELL_BOOTSTRAP_QUERY, type AppShellBootstrapData } from '../../graphql/auth.graphql';
import {
    SET_SETTINGS_STORE_VALUE_MUTATION,
    type SettingsStoreFieldRecord,
} from '../../graphql/management.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useAdminQuery } from '../../hooks/use-admin-query';
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
    channelCode: suppliedChannelCode,
    onChanged,
    onError,
}: {
    fields: SettingsStoreFieldRecord[];
    channelCode?: string;
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const { permissions } = useAdminPermissions();
    const context = useAdminQuery<AppShellBootstrapData>(APP_SHELL_BOOTSTRAP_QUERY, {
        fetchPolicy: 'cache-first',
        skip: Boolean(suppliedChannelCode),
    });
    const channelCode = suppliedChannelCode ?? context.data?.activeChannel?.code;
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
    const filtered = fields.filter(
        field => (scope === 'ALL' || field.scopeType === scope) && matchesSettingsSearch(field, search),
    );
    const technical = filtered.filter(field => getSettingsPresentation(field.key).group === 'technical');
    const editor = fields.find(field => field.key === editorKey);
    const storeContext = Boolean(channelCode && !isPlatformManagementChannel(channelCode));
    const update = async (field: SettingsStoreFieldRecord, value: unknown) => {
        if (state.loading || field.readonly) return;
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
                        <h2 className="admin-section-title-line text-sm font-bold text-slate-900">
                            设置说明与入口
                            <span className="text-xs font-normal text-slate-500">中文摘要与专用入口</span>
                            <FeatureHelpButton topic="settings.dynamic-config" title="设置说明与入口" />
                        </h2>
                        <p className="mt-2 text-xs leading-5 text-slate-500">
                            日常功能请在对应设置页调整，那里有完整的说明、校验和保存操作。
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
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
                                {(['GLOBAL', 'CHANNEL', 'USER', 'USER_AND_CHANNEL', 'CUSTOM'] as const).map(
                                    value => (
                                        <option key={value} value={value}>
                                            {getSettingsScopeLabel(value)}
                                        </option>
                                    ),
                                )}
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
                                        <div className="admin-section-title-line">
                                            <h3 className="text-sm font-bold text-slate-900">
                                                {group.title}
                                            </h3>
                                            <span className="text-xs text-slate-500">已保存配置摘要</span>
                                        </div>
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
                                <div
                                    className="admin-comparison-scroll mt-3"
                                    role="region"
                                    tabIndex={0}
                                    aria-label={`${group.title}配置表，可横向滚动`}
                                >
                                    <table className="admin-compact-table w-full min-w-[800px] table-fixed text-left text-xs">
                                        <colgroup>
                                            <col className="w-[23%]" />
                                            <col className="w-[13%]" />
                                            <col className="w-[15%]" />
                                            <col className="w-[49%]" />
                                        </colgroup>
                                        <thead className="border-y border-slate-100 bg-slate-50 text-slate-500">
                                            <tr>
                                                <th scope="col">配置名称</th>
                                                <th scope="col">已保存摘要</th>
                                                <th scope="col">定义范围</th>
                                                <th scope="col">用途</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {entries.map(field => (
                                                <tr key={field.key}>
                                                    <td
                                                        data-label="配置名称"
                                                        className="font-semibold text-slate-800"
                                                    >
                                                        {getSettingsPresentation(field.key).title}
                                                    </td>
                                                    <td data-label="已保存摘要">
                                                        {getSettingsValueSummary(field)}
                                                    </td>
                                                    <td data-label="定义范围">
                                                        {getSettingsScopeLabel(field.scopeType)}
                                                    </td>
                                                    <td data-label="用途">
                                                        <span
                                                            className="block truncate"
                                                            title={
                                                                getSettingsPresentation(field.key).description
                                                            }
                                                        >
                                                            {getSettingsPresentation(field.key).description}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
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
                    <div
                        className="admin-comparison-scroll"
                        role="region"
                        tabIndex={0}
                        aria-label="技术配置表，可横向滚动"
                    >
                        <table className="admin-compact-table w-full min-w-[1080px] table-fixed text-left text-xs">
                            <colgroup>
                                <col className="w-[18%]" />
                                <col className="w-[10%]" />
                                <col className="w-[12%]" />
                                <col className="w-[30%]" />
                                <col className="w-[14%]" />
                                <col className="w-[16%]" />
                            </colgroup>
                            <thead className="border-y border-slate-100 bg-slate-50 text-slate-500">
                                <tr>
                                    <th scope="col">配置名称</th>
                                    <th scope="col">已保存摘要</th>
                                    <th scope="col">定义范围</th>
                                    <th scope="col">用途</th>
                                    <th scope="col">维护方式</th>
                                    <th scope="col" className="sticky right-0 bg-slate-50 text-right">
                                        操作
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {technical.map(field => (
                                    <tr key={field.key}>
                                        <td data-label="配置名称" className="font-semibold text-slate-800">
                                            {getSettingsPresentation(field.key).title}
                                        </td>
                                        <td data-label="已保存摘要">{getSettingsValueSummary(field)}</td>
                                        <td data-label="定义范围">
                                            {getSettingsScopeLabel(field.scopeType)}
                                        </td>
                                        <td data-label="用途">
                                            <span
                                                className="block truncate"
                                                title={getSettingsPresentation(field.key).description}
                                            >
                                                {getSettingsPresentation(field.key).description}
                                            </span>
                                        </td>
                                        <td data-label="维护方式">
                                            {field.readonly ? '系统自动维护，只读' : '可高级编辑'}
                                        </td>
                                        <td data-label="操作" className="sticky right-0 bg-white text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <TechnicalDetails
                                                    entries={[
                                                        { label: '配置键', value: field.key },
                                                        {
                                                            label: '原始数据',
                                                            value: settingsEditorValue(field.currentValue),
                                                        },
                                                    ]}
                                                />
                                                {!field.readonly && (
                                                    <AdminButton
                                                        type="button"
                                                        onClick={event => {
                                                            editorTrigger.current = event.currentTarget;
                                                            setEditorKey(field.key);
                                                        }}
                                                        disabled={state.loading}
                                                        className={secondaryButton}
                                                        aria-label={`高级编辑${getSettingsPresentation(field.key).title}`}
                                                    >
                                                        高级编辑
                                                    </AdminButton>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
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
            const value: unknown = JSON.parse(draft ?? 'null');
            if (value === null) {
                setError('此接口不接受顶层 null；请填写有效配置值。');
                return;
            }
            onSave(value);
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
                    <div className="admin-section-title-line justify-between">
                        <h2 className="font-bold text-slate-900">
                            高级编辑：{getSettingsPresentation(field.key).title}
                        </h2>
                        <span className="text-xs text-slate-500">
                            {getSettingsScopeLabel(field.scopeType)} · 原始格式
                        </span>
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
