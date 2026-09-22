import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    ArrowRightLeft,
    CheckCircle2,
    KeyRound,
    LoaderCircle,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    Shield,
    Trash2,
    Users,
    X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { logoutAdministrator, sensitiveActionContext } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import {
    CREATE_ADMINISTRATOR_MUTATION,
    CREATE_ROLE_MUTATION,
    DELETE_ADMINISTRATOR_MUTATION,
    TEAM_MANAGEMENT_QUERY,
    TRANSFER_PLATFORM_OWNERSHIP_MUTATION,
    TRANSFER_STORE_ADMINISTRATION_MUTATION,
    UPDATE_ADMINISTRATOR_MUTATION,
    UPDATE_ROLE_MUTATION,
    type AdministratorAccessRecord,
    type AdministratorRecord,
    type PermissionPolicyRecord,
    type RoleRecord,
    type TeamManagementResult,
} from '../../graphql/management.graphql';
import { useUrlTab } from '../../hooks/use-url-tab';
import { getChannelDisplayName } from '../../utils/channel-display';
import { getRoleCodeLabel, getRoleLabel } from '../../utils/status-labels';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatDateTime } from '../Sales/sales-utils';
import { SettingsContentSkeleton } from './settings-ui';

type Tab = 'MEMBERS' | 'ROLES';
const ROLE_TABS = { members: 'MEMBERS', roles: 'ROLES' } as const;

export function RolesModule() {
    const [tab, setTab] = useUrlTab<Tab>(ROLE_TABS, 'members');
    const [search, setSearch] = useState('');
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const [roleEditor, setRoleEditor] = useState<RoleRecord | 'NEW' | null>(null);
    const [memberEditor, setMemberEditor] = useState<AdministratorRecord | 'NEW' | null>(null);
    const query = useQuery<TeamManagementResult>(TEAM_MANAGEMENT_QUERY, {
        fetchPolicy: 'cache-and-network',
    });
    const isTeamInitializing = !query.error && !query.data;

    const roles = query.data?.manageableRoles ?? [];
    const canManageTeam = ['OWNER', 'ADMIN'].includes(query.data?.myAdministratorAccess.authority ?? '');
    const members =
        query.data?.manageableAdministrators.map(access => ({
            ...access.administrator,
            access: {
                id: access.id,
                scope: access.scope,
                authority: access.authority,
                status: access.status,
                channel: access.channel,
            },
        })) ?? [];
    const filteredMembers = members.filter(item =>
        includesSearch(
            `${item.firstName} ${item.lastName} ${item.emailAddress} ${item.user.identifier} ${item.user.roles.map(role => `${role.code} ${role.description} ${getRoleLabel(role)}`).join(' ')}`,
            search,
        ),
    );
    const filteredRoles = roles.filter(item =>
        includesSearch(
            `${item.code} ${item.description} ${getRoleLabel(item)} ${item.channels.map(channel => `${channel.code} ${getChannelDisplayName(channel)}`).join(' ')} ${item.permissions.join(' ')}`,
            search,
        ),
    );

    const completed = async (message: string) => {
        setNotice(message);
        setActionError('');
        setRoleEditor(null);
        setMemberEditor(null);
        await query.refetch();
    };

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            <Shield className="h-5 w-5 text-blue-600" />
                            员工与权限
                            <FeatureHelpButton topic="settings.team" title="员工与权限" />
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            账号、角色和渠道范围集中管理；权限项直接读取当前服务端定义
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => void query.refetch()}
                            disabled={query.loading}
                            className={secondaryButton}
                            aria-label="刷新"
                        >
                            <RefreshCw className={`h-4 w-4 ${query.loading ? 'animate-spin' : ''}`} />
                        </button>
                        {canManageTeam && (
                            <button
                                type="button"
                                onClick={() =>
                                    tab === 'MEMBERS' ? setMemberEditor('NEW') : setRoleEditor('NEW')
                                }
                                className={primaryButton}
                            >
                                <Plus className="h-4 w-4" />
                                {tab === 'MEMBERS' ? '新增员工' : '新建角色'}
                            </button>
                        )}
                    </div>
                </div>
            </header>
            <main className="min-h-0 w-full max-w-none flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
                {notice && (
                    <Message kind="success" onClose={() => setNotice('')}>
                        {notice}
                    </Message>
                )}
                {actionError && (
                    <Message kind="error" onClose={() => setActionError('')}>
                        {actionError}
                    </Message>
                )}
                {query.data?.myAdministratorAccess.authority === 'OWNER' && (
                    <details className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
                        <summary className="cursor-pointer font-bold">平台所有者专属权限（不可下放）</summary>
                        <p className="mt-2 leading-5">
                            全平台仅一名所有者；所有权转移、创建同级平台管理员与店铺清退使用专用流程。
                        </p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {query.data.permissionPolicyCatalog.permissions
                                .filter(permission => permission.scope === 'OWNER_ONLY')
                                .map(permission => (
                                    <div key={permission.code} className="rounded-lg bg-white/70 p-2">
                                        <strong className="block">{permission.name}</strong>
                                        <span className="mt-1 block text-amber-900/75">
                                            {permission.description}
                                        </span>
                                    </div>
                                ))}
                        </div>
                    </details>
                )}
                {query.data?.myAdministratorAccess.scope === 'PLATFORM' && (
                    <details className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-800">
                        <summary className="cursor-pointer font-bold">
                            公司跨店权限（只可授予平台岗位，不可授予店铺岗位）
                        </summary>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {query.data.permissionPolicyCatalog.permissions
                                .filter(permission => permission.scope === 'PLATFORM' && permission.delegable)
                                .map(permission => (
                                    <div key={permission.code} className="rounded-lg bg-slate-50 p-2">
                                        <strong className="block">{permission.name}</strong>
                                        <span className="mt-1 block text-slate-500">
                                            {permission.description}
                                        </span>
                                    </div>
                                ))}
                        </div>
                    </details>
                )}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="inline-flex w-max rounded-lg border border-slate-200 bg-white p-1">
                        <TabButton
                            active={tab === 'MEMBERS'}
                            onClick={() => setTab('MEMBERS')}
                            icon={<Users className="h-3.5 w-3.5" />}
                        >
                            员工账号 {members.length}
                        </TabButton>
                        <TabButton
                            active={tab === 'ROLES'}
                            onClick={() => setTab('ROLES')}
                            icon={<KeyRound className="h-3.5 w-3.5" />}
                        >
                            角色权限 {roles.length}
                        </TabButton>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                        <input
                            value={search}
                            onChange={event => setSearch(event.target.value)}
                            placeholder={tab === 'MEMBERS' ? '搜索姓名、邮箱或角色' : '搜索角色、渠道或权限'}
                            className={`${inputClass} w-full pl-8 sm:w-72`}
                        />
                    </div>
                </div>
                {query.error && !query.data ? (
                    <ErrorState
                        message={toUserFacingError(query.error, '员工与权限数据读取失败')}
                        onRetry={() => void query.refetch()}
                    />
                ) : isTeamInitializing ? (
                    <SettingsContentSkeleton label="正在读取员工与权限数据" sections={2} />
                ) : tab === 'MEMBERS' ? (
                    <MembersTable
                        members={filteredMembers}
                        activeId={query.data?.activeAdministrator?.id ?? null}
                        actorAccess={query.data?.myAdministratorAccess ?? null}
                        onEdit={setMemberEditor}
                        onChanged={completed}
                        onError={setActionError}
                    />
                ) : (
                    <RolesTable
                        roles={filteredRoles}
                        memberCount={roleId =>
                            members.filter(member => member.user.roles.some(role => role.id === roleId))
                                .length
                        }
                        onEdit={setRoleEditor}
                    />
                )}
            </main>
            {memberEditor && (
                <MemberEditor
                    value={memberEditor}
                    roles={roles}
                    access={query.data?.myAdministratorAccess ?? null}
                    channels={query.data?.manageableChannels ?? []}
                    onClose={() => setMemberEditor(null)}
                    onCompleted={completed}
                    onError={setActionError}
                />
            )}
            {roleEditor && query.data && (
                <RoleEditor
                    value={roleEditor}
                    roles={roles}
                    access={query.data.myAdministratorAccess}
                    channels={query.data.manageableChannels}
                    permissionDefinitions={query.data.permissionPolicyCatalog.permissions}
                    templates={query.data.permissionPolicyCatalog.templates}
                    onClose={() => setRoleEditor(null)}
                    onCompleted={completed}
                    onError={setActionError}
                />
            )}
        </div>
    );
}

function MembersTable({
    members,
    activeId,
    actorAccess,
    onEdit,
    onChanged,
    onError,
}: {
    members: AdministratorRecord[];
    activeId: string | null;
    actorAccess: AdministratorAccessRecord | null;
    onEdit: (member: AdministratorRecord) => void;
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const navigate = useNavigate();
    const [remove, state] = useMutation<{
        suspendManagedAdministrator: { id: string; status: string };
    }>(DELETE_ADMINISTRATOR_MUTATION);
    const [transferOwnership, ownershipState] = useMutation<{
        transferPlatformOwnership: { id: string; authority: string };
    }>(TRANSFER_PLATFORM_OWNERSHIP_MUTATION);
    const [transferStore, storeTransferState] = useMutation<{
        transferStoreAdministration: { id: string; authority: string };
    }>(TRANSFER_STORE_ADMINISTRATION_MUTATION);
    const destroy = async (member: AdministratorRecord) => {
        if (member.id === activeId) return;
        const confirmation = await requestConfirmation({
            title: `停用员工账号“${member.firstName}${member.lastName}”？`,
            description: `${member.emailAddress}\n停用后会立即撤销该账号的全部登录会话。`,
            confirmLabel: '确认停用',
            tone: 'danger',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        try {
            const response = await remove({
                variables: { administratorId: member.id },
                context: sensitiveActionContext(confirmation.currentPassword ?? ''),
            });
            const result = response.data?.suspendManagedAdministrator;
            if (!result || result.status !== 'SUSPENDED') throw new Error('停用失败');
            await onChanged('员工账号已停用并撤销全部会话');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const transfer = async (member: AdministratorRecord, kind: 'PLATFORM' | 'STORE') => {
        const channelId = member.access.channel?.id;
        if (kind === 'STORE' && !channelId) return onError('目标账号未绑定店铺');
        const name = `${member.firstName}${member.lastName}`;
        const confirmation = await requestConfirmation({
            title: kind === 'PLATFORM' ? `将平台所有权移交给“${name}”？` : `将店铺主管理员移交给“${name}”？`,
            description:
                kind === 'PLATFORM'
                    ? '此操作会撤销您和目标账号的全部登录会话。您将降为平台管理员；平台仍只能有一名所有者。'
                    : `目标账号将成为${getChannelDisplayName(member.access.channel?.code ?? '')}的唯一主管理员，原主管理员将降为普通管理员；双方会话立即失效。`,
            confirmLabel: '确认移交',
            tone: 'danger',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        try {
            if (kind === 'PLATFORM') {
                const response = await transferOwnership({
                    variables: {
                        targetAdministratorId: member.id,
                        currentPassword: confirmation.currentPassword ?? '',
                    },
                });
                if (response.data?.transferPlatformOwnership.authority !== 'OWNER')
                    throw new Error('平台所有权移交失败');
            } else {
                const response = await transferStore({
                    variables: {
                        channelId,
                        targetAdministratorId: member.id,
                        currentPassword: confirmation.currentPassword ?? '',
                    },
                });
                if (response.data?.transferStoreAdministration.authority !== 'ADMIN')
                    throw new Error('店铺主管理员移交失败');
            }
        } catch (error) {
            onError(errorText(error));
            return;
        }
        if (kind === 'PLATFORM' || actorAccess?.scope === 'STORE') {
            try {
                await logoutAdministrator();
            } catch {
                // The server has already revoked this session; local auth is cleared in finally.
            }
            navigate('/login', { replace: true });
            return;
        }
        await onChanged('店铺主管理员已移交，相关账号需要重新登录');
    };
    return (
        <section className="min-h-[620px] overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
                <table className="w-full min-w-[1500px] border-collapse text-left text-xs">
                    <thead>
                        <tr className={theadClass}>
                            <th
                                scope="col"
                                className="sticky left-0 z-20 w-40 whitespace-nowrap bg-slate-50 px-3 py-3"
                            >
                                姓名
                            </th>
                            <th scope="col" className="w-24 whitespace-nowrap px-3 py-3">
                                当前账号
                            </th>
                            <th scope="col" className="w-56 whitespace-nowrap px-3 py-3">
                                邮箱
                            </th>
                            <th scope="col" className="w-48 whitespace-nowrap px-3 py-3">
                                登录标识
                            </th>
                            <th scope="col" className="w-56 whitespace-nowrap px-3 py-3">
                                角色
                            </th>
                            <th scope="col" className="w-40 whitespace-nowrap px-3 py-3">
                                最近登录
                            </th>
                            <th scope="col" className="w-40 whitespace-nowrap px-3 py-3">
                                创建时间
                            </th>
                            <th
                                scope="col"
                                className="sticky right-0 z-20 w-44 whitespace-nowrap border-l border-slate-200 bg-slate-50 px-3 py-3 text-right"
                            >
                                操作
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {members.map(member => (
                            <tr key={member.id} className="group h-[52px] hover:bg-slate-50">
                                <td className="sticky left-0 z-10 h-[52px] max-w-40 bg-white px-3 py-0 font-bold text-slate-900 group-hover:bg-slate-50">
                                    <span
                                        className="block truncate"
                                        title={`${member.firstName}${member.lastName}`}
                                    >
                                        {member.firstName}
                                        {member.lastName}
                                    </span>
                                </td>
                                <td className="h-[52px] whitespace-nowrap px-3 py-0 text-[10px] font-bold">
                                    <span
                                        className={
                                            member.id === activeId ? 'text-blue-700' : 'text-slate-400'
                                        }
                                    >
                                        {member.id === activeId ? '是' : '否'}
                                    </span>
                                </td>
                                <td className="h-[52px] max-w-56 px-3 py-0">
                                    <span className="block truncate" title={member.emailAddress}>
                                        {member.emailAddress}
                                    </span>
                                </td>
                                <td className="h-[52px] max-w-48 px-3 py-0 font-mono text-[10px] text-slate-500">
                                    <span className="block truncate" title={member.user.identifier}>
                                        {member.user.identifier}
                                    </span>
                                </td>
                                <td className="h-[52px] max-w-56 px-3 py-0">
                                    <div className="flex max-w-52 items-center gap-1 whitespace-nowrap">
                                        <span
                                            className="min-w-0 truncate rounded bg-slate-100 px-2 py-1 text-[10px] text-slate-600"
                                            title={getRoleLabel(member.user.roles[0])}
                                        >
                                            {getRoleLabel(member.user.roles[0])}
                                        </span>
                                        {member.user.roles.length > 1 && (
                                            <span className="shrink-0 text-[10px] text-slate-500">
                                                +{member.user.roles.length - 1}
                                            </span>
                                        )}
                                        <span className="shrink-0 rounded bg-blue-50 px-1.5 py-1 text-[9px] font-bold text-blue-700">
                                            {member.access.scope === 'PLATFORM'
                                                ? '跨店'
                                                : getChannelDisplayName(member.access.channel?.code ?? '')}
                                        </span>
                                    </div>
                                </td>
                                <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-500">
                                    {member.user.lastLogin
                                        ? formatDateTime(member.user.lastLogin)
                                        : '从未登录'}
                                </td>
                                <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-400">
                                    {formatDateTime(member.createdAt)}
                                </td>
                                <td className="sticky right-0 z-10 h-[52px] whitespace-nowrap border-l border-slate-100 bg-white px-3 py-0 group-hover:bg-slate-50">
                                    <div className="flex justify-end gap-1">
                                        {actorAccess?.authority === 'OWNER' &&
                                            member.access.scope === 'PLATFORM' &&
                                            member.access.status === 'ACTIVE' && (
                                                <button
                                                    type="button"
                                                    onClick={() => void transfer(member, 'PLATFORM')}
                                                    disabled={
                                                        ownershipState.loading || storeTransferState.loading
                                                    }
                                                    className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-2 py-1 text-[10px] font-bold text-amber-800 hover:bg-amber-50 disabled:opacity-30"
                                                    aria-label={`移交平台所有权给${member.firstName}${member.lastName}`}
                                                    title="移交平台所有权"
                                                >
                                                    <ArrowRightLeft className="h-3 w-3" />
                                                    移交所有权
                                                </button>
                                            )}
                                        {(actorAccess?.authority === 'OWNER' ||
                                            actorAccess?.authority === 'ADMIN') &&
                                            member.access.scope === 'STORE' &&
                                            (actorAccess.scope === 'PLATFORM' ||
                                                actorAccess.channel?.id === member.access.channel?.id) &&
                                            ['MANAGER', 'STAFF'].includes(member.access.authority) &&
                                            member.access.status === 'ACTIVE' && (
                                                <button
                                                    type="button"
                                                    onClick={() => void transfer(member, 'STORE')}
                                                    disabled={
                                                        ownershipState.loading || storeTransferState.loading
                                                    }
                                                    className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-2 py-1 text-[10px] font-bold text-amber-800 hover:bg-amber-50 disabled:opacity-30"
                                                    aria-label={`移交店铺主管理员给${member.firstName}${member.lastName}`}
                                                    title="移交店铺主管理员"
                                                >
                                                    <ArrowRightLeft className="h-3 w-3" />
                                                    移交主管理员
                                                </button>
                                            )}
                                        <button
                                            type="button"
                                            onClick={() => onEdit(member)}
                                            disabled={
                                                member.id === activeId ||
                                                member.access.authority === 'OWNER' ||
                                                (member.access.scope === 'STORE' &&
                                                    member.access.authority === 'ADMIN')
                                            }
                                            className={`${iconButton} disabled:opacity-30`}
                                            aria-label="编辑"
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void destroy(member)}
                                            disabled={
                                                member.id === activeId ||
                                                member.access.authority === 'OWNER' ||
                                                (member.access.scope === 'STORE' &&
                                                    member.access.authority === 'ADMIN') ||
                                                state.loading
                                            }
                                            className={`${iconButton} text-rose-600 disabled:opacity-30`}
                                            aria-label="停用"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {!members.length && <EmptyRow colSpan={8} text="没有符合条件的员工账号" />}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function RolesTable({
    roles,
    memberCount,
    onEdit,
}: {
    roles: RoleRecord[];
    memberCount: (id: string) => number;
    onEdit: (role: RoleRecord) => void;
}) {
    return (
        <section className="min-h-[620px] overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
                <table className="w-full min-w-[1120px] border-collapse text-left text-xs">
                    <thead>
                        <tr className={theadClass}>
                            <th
                                scope="col"
                                className="sticky left-0 z-20 w-52 whitespace-nowrap bg-slate-50 px-3 py-3"
                            >
                                角色名称
                            </th>
                            <th scope="col" className="w-24 whitespace-nowrap px-3 py-3">
                                类型
                            </th>
                            <th scope="col" className="w-56 whitespace-nowrap px-3 py-3">
                                渠道范围
                            </th>
                            <th scope="col" className="w-24 whitespace-nowrap px-3 py-3">
                                权限
                            </th>
                            <th scope="col" className="w-24 whitespace-nowrap px-3 py-3">
                                关联员工
                            </th>
                            <th
                                scope="col"
                                className="sticky right-0 z-20 w-44 whitespace-nowrap border-l border-slate-200 bg-slate-50 px-3 py-3 text-right"
                            >
                                操作
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {roles.map(role => {
                            const system = isSystemRole(role);
                            return (
                                <tr key={role.id} className="group h-[52px] hover:bg-slate-50">
                                    <td className="sticky left-0 z-10 h-[52px] max-w-52 bg-white px-3 py-0 group-hover:bg-slate-50">
                                        <div className="flex items-center gap-2 truncate font-bold text-slate-900">
                                            <Shield
                                                className={`h-4 w-4 ${system ? 'text-emerald-600' : 'text-blue-600'}`}
                                            />
                                            {getRoleLabel(role)}
                                        </div>
                                    </td>
                                    <td className="h-[52px] whitespace-nowrap px-3 py-0 text-[10px] font-bold text-slate-600">
                                        {system ? '系统保留' : '自定义'}
                                    </td>
                                    <td className="h-[52px] max-w-56 px-3 py-0 text-slate-600">
                                        <span
                                            className="block truncate"
                                            title={
                                                system
                                                    ? '全部渠道'
                                                    : role.channels.length
                                                      ? role.channels
                                                            .map(channel => getChannelDisplayName(channel))
                                                            .join('、')
                                                      : '未限定渠道'
                                            }
                                        >
                                            {system
                                                ? '全部渠道'
                                                : role.channels.length
                                                  ? role.channels
                                                        .map(channel => getChannelDisplayName(channel))
                                                        .join('、')
                                                  : '未限定渠道'}
                                        </span>
                                    </td>
                                    <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono font-bold text-blue-700">
                                        {role.permissions.length} 项
                                    </td>
                                    <td className="h-[52px] whitespace-nowrap px-3 py-0">
                                        {memberCount(role.id)} 人
                                    </td>
                                    <td className="sticky right-0 z-10 h-[52px] whitespace-nowrap border-l border-slate-100 bg-white px-3 py-0 group-hover:bg-slate-50">
                                        <div className="flex justify-end gap-1">
                                            <button
                                                type="button"
                                                onClick={() => onEdit(role)}
                                                className={secondaryButton}
                                            >
                                                {system ? '查看权限' : '配置权限'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {!roles.length && <EmptyRow colSpan={6} text="没有符合条件的角色" />}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function MemberEditor({
    value,
    roles,
    access,
    channels,
    onClose,
    onCompleted,
    onError,
}: {
    value: AdministratorRecord | 'NEW';
    roles: RoleRecord[];
    access: AdministratorAccessRecord | null;
    channels: Array<{
        id: string;
        code: string;
        customFields?: { storefrontNameZh?: string | null } | null;
    }>;
    onClose: () => void;
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const existing = value === 'NEW' ? null : value;
    const [firstName, setFirstName] = useState(existing?.firstName ?? '');
    const [lastName, setLastName] = useState(existing?.lastName ?? '');
    const [emailAddress, setEmailAddress] = useState(existing?.emailAddress ?? '');
    const [password, setPassword] = useState('');
    const [roleIds, setRoleIds] = useState(existing?.user.roles.map(role => role.id) ?? []);
    const [scope, setScope] = useState<'PLATFORM' | 'STORE'>(
        existing?.access.scope ?? (access?.scope === 'STORE' ? 'STORE' : 'PLATFORM'),
    );
    const [authority, setAuthority] = useState<'ADMIN' | 'MANAGER' | 'STAFF'>(
        existing?.access.authority === 'OWNER' ? 'ADMIN' : (existing?.access.authority ?? 'STAFF'),
    );
    const [channelId, setChannelId] = useState(
        existing?.access.channel?.id ??
            access?.channel?.id ??
            channels.find(channel => channel.code !== '__default_channel__')?.id ??
            '',
    );
    const selectableRoles = roles.filter(role =>
        scope === 'STORE'
            ? role.channels.length === 1 && role.channels.some(channel => channel.id === channelId)
            : role.channels.some(channel => channel.code === '__default_channel__'),
    );
    const usesFixedPlatformRole = scope === 'PLATFORM' && authority === 'ADMIN';
    const [create, createState] = useMutation(CREATE_ADMINISTRATOR_MUTATION);
    const [update, updateState] = useMutation(UPDATE_ADMINISTRATOR_MUTATION);
    const saving = createState.loading || updateState.loading;
    const save = async () => {
        if (![firstName, lastName, emailAddress].every(item => item.trim()))
            return onError('请填写姓名和邮箱');
        if (!usesFixedPlatformRole && roleIds.length === 0) return onError('请至少选择一个岗位角色');
        if (scope === 'STORE' && !channelId) return onError('请选择员工所属店铺');
        if (!existing && password.length < 8) return onError('新员工初始密码至少需要 8 位');
        try {
            if (existing)
                await update({
                    variables: {
                        input: {
                            id: existing.id,
                            firstName: firstName.trim(),
                            lastName: lastName.trim(),
                            emailAddress: emailAddress.trim(),
                            roleIds: usesFixedPlatformRole ? [] : roleIds,
                            authority,
                            ...(password ? { password } : {}),
                        },
                    },
                });
            else
                await create({
                    variables: {
                        input: {
                            firstName: firstName.trim(),
                            lastName: lastName.trim(),
                            emailAddress: emailAddress.trim(),
                            password,
                            roleIds: usesFixedPlatformRole ? [] : roleIds,
                            scope,
                            authority,
                            channelId: scope === 'STORE' ? channelId : null,
                        },
                    },
                });
            await onCompleted(existing ? '员工账号已更新' : '员工账号已创建');
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <Modal
            title={existing ? '编辑员工账号' : '新增员工账号'}
            description={existing ? '留空密码表示不修改当前密码' : '创建后请通过安全渠道告知员工初始密码'}
            onClose={onClose}
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="名 *">
                    <input
                        value={firstName}
                        onChange={event => setFirstName(event.target.value)}
                        className={inputClass}
                    />
                </Field>
                <Field label="姓 *">
                    <input
                        value={lastName}
                        onChange={event => setLastName(event.target.value)}
                        className={inputClass}
                    />
                </Field>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="登录邮箱 *">
                    <input
                        type="email"
                        value={emailAddress}
                        onChange={event => setEmailAddress(event.target.value)}
                        className={inputClass}
                    />
                </Field>
                <Field label={existing ? '新密码（不改请留空）' : '初始密码 *'}>
                    <input
                        type="password"
                        value={password}
                        onChange={event => setPassword(event.target.value)}
                        className={inputClass}
                        autoComplete="new-password"
                    />
                </Field>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="账号层级 *">
                    <select
                        value={authority}
                        onChange={event => {
                            setAuthority(event.target.value as 'ADMIN' | 'MANAGER' | 'STAFF');
                            setRoleIds([]);
                        }}
                        className={inputClass}
                    >
                        {access?.authority === 'OWNER' && scope === 'PLATFORM' && (
                            <option value="ADMIN">平台管理员</option>
                        )}
                        <option value="MANAGER">
                            {scope === 'STORE' ? '店铺普通管理员' : '公司业务管理员'}
                        </option>
                        <option value="STAFF">{scope === 'STORE' ? '店铺员工' : '公司员工'}</option>
                    </select>
                </Field>
                {access?.scope === 'PLATFORM' && !existing ? (
                    <Field label="数据范围 *">
                        <select
                            value={scope}
                            onChange={event => {
                                const nextScope = event.target.value as 'PLATFORM' | 'STORE';
                                setScope(nextScope);
                                setRoleIds([]);
                                if (nextScope === 'STORE' && authority === 'ADMIN') setAuthority('STAFF');
                            }}
                            className={inputClass}
                        >
                            <option value="PLATFORM">公司跨店</option>
                            <option value="STORE">固定店铺</option>
                        </select>
                    </Field>
                ) : (
                    <Field label="数据范围">
                        <input
                            value={
                                scope === 'PLATFORM'
                                    ? '公司跨店'
                                    : getChannelDisplayName(existing?.access.channel ?? access?.channel ?? '')
                            }
                            disabled
                            className={inputClass}
                        />
                    </Field>
                )}
            </div>
            {scope === 'STORE' && access?.scope === 'PLATFORM' && !existing && (
                <div className="mt-4">
                    <Field label="所属店铺 *">
                        <select
                            value={channelId}
                            onChange={event => {
                                setChannelId(event.target.value);
                                setRoleIds([]);
                            }}
                            className={inputClass}
                        >
                            {channels
                                .filter(channel => channel.code !== '__default_channel__')
                                .map(channel => (
                                    <option key={channel.id} value={channel.id}>
                                        {getChannelDisplayName(channel)}
                                    </option>
                                ))}
                        </select>
                    </Field>
                </div>
            )}
            {usesFixedPlatformRole ? (
                <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                    平台管理员自动使用系统固定岗位，可协助管理全部店铺；平台所有者专属权限不会下放。
                </div>
            ) : (
                <div className="mt-5">
                    <div className="mb-2 text-xs font-bold text-slate-700">分配角色 *</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                        {selectableRoles.map(role => (
                            <label
                                key={role.id}
                                className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-xs"
                            >
                                <input
                                    type="checkbox"
                                    checked={roleIds.includes(role.id)}
                                    onChange={() =>
                                        setRoleIds(current =>
                                            current.includes(role.id)
                                                ? current.filter(id => id !== role.id)
                                                : [...current, role.id],
                                        )
                                    }
                                    className="mt-0.5"
                                />
                                <span>
                                    <strong className="block text-slate-800">{getRoleLabel(role)}</strong>
                                    <span className="mt-1 block font-mono text-[9px] text-slate-400">
                                        {getRoleCodeLabel(role.code)}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </div>
                </div>
            )}
            <ModalActions
                onClose={onClose}
                onSave={() => void save()}
                saving={saving}
                saveLabel={existing ? '保存修改' : '创建员工'}
            />
        </Modal>
    );
}

function RoleEditor({
    value,
    roles,
    access,
    channels,
    permissionDefinitions,
    templates,
    onClose,
    onCompleted,
    onError,
}: {
    value: RoleRecord | 'NEW';
    roles: RoleRecord[];
    access: AdministratorAccessRecord;
    channels: Array<{
        id: string;
        code: string;
        customFields?: { storefrontNameZh?: string | null } | null;
    }>;
    permissionDefinitions: PermissionPolicyRecord[];
    templates: Array<{ code: string; name: string; description: string; permissions: string[] }>;
    onClose: () => void;
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const existing = value === 'NEW' ? null : value;
    const system = Boolean(existing && isSystemRole(existing));
    const [code, setCode] = useState(existing?.code ?? '');
    const initialDescription = existing ? getRoleLabel(existing) : '';
    const [description, setDescription] = useState(initialDescription);
    const existingLooksPlatform = Boolean(
        existing?.channels.some(channel => channel.code === '__default_channel__'),
    );
    const [scope, setScope] = useState<'PLATFORM' | 'STORE'>(
        access.scope === 'STORE' ? 'STORE' : existingLooksPlatform ? 'PLATFORM' : 'STORE',
    );
    const [channelId, setChannelId] = useState(
        existing?.channels[0]?.id ??
            access.channel?.id ??
            channels.find(channel => channel.code !== '__default_channel__')?.id ??
            '',
    );
    const [templateCode, setTemplateCode] = useState('');
    const [permissions, setPermissions] = useState(
        existing?.permissions.filter(permission => permission !== 'Authenticated') ?? [],
    );
    const [create, createState] = useMutation(CREATE_ROLE_MUTATION);
    const [update, updateState] = useMutation(UPDATE_ROLE_MUTATION);
    const saving = createState.loading || updateState.loading;
    const groups = useMemo(
        () =>
            groupPermissions(
                permissionDefinitions.filter(
                    item =>
                        item.delegable &&
                        (scope === 'STORE' ? item.scope === 'STORE' : item.scope !== 'OWNER_ONLY'),
                ),
            ),
        [permissionDefinitions, scope],
    );
    const save = async () => {
        if (system) return onClose();
        if (!code.trim() || !description.trim()) return onError('请填写角色名称和系统代码');
        if (!existing && roles.some(role => role.code.toLowerCase() === code.trim().toLowerCase()))
            return onError('角色代码已存在，请更换');
        try {
            const persistedDescription =
                existing && description.trim() === initialDescription
                    ? existing.description
                    : description.trim();
            const input = {
                code: code.trim(),
                description: persistedDescription,
                scope,
                channelId: scope === 'STORE' ? channelId : null,
                permissions,
                templateCode: templateCode || null,
            };
            if (existing) {
                const confirmation = await requestConfirmation({
                    title: `保存角色“${getRoleLabel(existing)}”的权限变更？`,
                    description: '保存后会立即撤销所有关联账号的旧会话，员工需重新登录。',
                    confirmLabel: '验证并保存',
                    tone: 'warning',
                    requireCurrentPassword: true,
                });
                if (!confirmation) return;
                await update({
                    variables: { input: { id: existing.id, ...input } },
                    context: sensitiveActionContext(confirmation.currentPassword ?? ''),
                });
            } else {
                await create({ variables: { input } });
            }
            await onCompleted(existing ? '角色权限已更新，关联账号需要重新登录' : '角色已创建');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const togglePermission = (name: string) =>
        setPermissions(current =>
            current.includes(name) ? current.filter(item => item !== name) : [...current, name],
        );
    return (
        <Modal
            wide
            title={existing ? (system ? '查看系统角色' : '配置角色权限') : '新建角色'}
            description="权限来自当前服务端注册结果，插件新增的权限也会自动出现在这里"
            onClose={onClose}
        >
            {system && (
                <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                    超级管理员为系统保留角色，拥有全部权限，不能在这里修改。
                </div>
            )}
            {!existing && (
                <div className="mb-4">
                    <Field label="岗位模板">
                        <select
                            value={templateCode}
                            onChange={event => {
                                const next = templates.find(item => item.code === event.target.value);
                                setTemplateCode(event.target.value);
                                if (!next) return;
                                setDescription(next.name);
                                setCode(`${next.code.toLowerCase()}-${scope.toLowerCase()}`);
                                setPermissions(next.permissions);
                            }}
                            className={inputClass}
                        >
                            <option value="">自定义岗位</option>
                            {templates.map(template => (
                                <option key={template.code} value={template.code}>
                                    {template.name}
                                </option>
                            ))}
                        </select>
                    </Field>
                </div>
            )}
            <div className="space-y-4">
                <Field label="角色名称 *">
                    <input
                        value={description}
                        onChange={event => setDescription(event.target.value)}
                        disabled={system}
                        className={inputClass}
                        placeholder="例如：订单客服"
                    />
                </Field>
                <details className="rounded-lg border border-slate-200 p-3">
                    <summary className="cursor-pointer text-xs font-bold text-slate-600">高级详情</summary>
                    <div className="mt-3">
                        <Field label="内部角色代码 *">
                            <input
                                value={code}
                                onChange={event => setCode(event.target.value)}
                                disabled={Boolean(existing)}
                                className={`${inputClass} font-mono`}
                                placeholder="order-support"
                            />
                        </Field>
                    </div>
                </details>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="角色数据范围 *">
                    <select
                        value={scope}
                        disabled={system || access.scope === 'STORE' || Boolean(existing)}
                        onChange={event => {
                            setScope(event.target.value as 'PLATFORM' | 'STORE');
                            setPermissions([]);
                            setTemplateCode('');
                        }}
                        className={inputClass}
                    >
                        {access.scope === 'PLATFORM' && <option value="PLATFORM">公司跨店角色</option>}
                        <option value="STORE">单店角色</option>
                    </select>
                </Field>
                {scope === 'STORE' ? (
                    <Field label="所属店铺 *">
                        <select
                            value={channelId}
                            disabled={system || access.scope === 'STORE' || Boolean(existing)}
                            onChange={event => setChannelId(event.target.value)}
                            className={inputClass}
                        >
                            {channels
                                .filter(channel => channel.code !== '__default_channel__')
                                .map(channel => (
                                    <option key={channel.id} value={channel.id}>
                                        {getChannelDisplayName(channel)}
                                    </option>
                                ))}
                        </select>
                    </Field>
                ) : (
                    <Field label="未来新店">
                        <input value="自动覆盖所有现有及未来经营店铺" disabled className={inputClass} />
                    </Field>
                )}
            </div>
            <div className="mt-6 border-t border-slate-100 pt-5">
                <div className="mb-3 flex items-center justify-between">
                    <div>
                        <div className="text-xs font-bold text-slate-700">操作权限</div>
                        <p className="mt-1 text-[10px] text-slate-400">
                            只显示当前层级可下放的权限；保存后关联账号需重新登录
                        </p>
                    </div>
                    <span className="font-mono text-xs font-bold text-blue-700">{permissions.length} 项</span>
                </div>
                <div className="max-h-[46vh] space-y-3 overflow-y-auto pr-1">
                    {groups.map(group => (
                        <div key={group.name} className="rounded-xl border border-slate-200">
                            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                                <strong className="text-xs text-slate-800">{group.label}</strong>
                                <button
                                    type="button"
                                    disabled={system}
                                    onClick={() => {
                                        const names = group.items.map(item => item.name);
                                        const all = names.every(name => permissions.includes(name));
                                        setPermissions(current =>
                                            all
                                                ? current.filter(name => !names.includes(name))
                                                : [...new Set([...current, ...names])],
                                        );
                                    }}
                                    className="text-[10px] font-bold text-blue-600 disabled:opacity-40"
                                >
                                    {group.items.every(item => permissions.includes(item.name))
                                        ? '取消本组'
                                        : '全选本组'}
                                </button>
                            </div>
                            <div className="grid gap-1 p-3 sm:grid-cols-2">
                                {group.items.map(item => (
                                    <label
                                        key={item.name}
                                        className="flex cursor-pointer items-start gap-2 rounded-lg p-2 hover:bg-slate-50"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={system || permissions.includes(item.name)}
                                            onChange={() => togglePermission(item.name)}
                                            disabled={system}
                                            className="mt-0.5"
                                        />
                                        <span>
                                            <span
                                                className="block text-[10px] font-bold text-slate-700"
                                                title={item.name}
                                            >
                                                {item.display.label}
                                            </span>
                                            <span className="mt-0.5 block text-[9px] leading-4 text-slate-400">
                                                {item.display.description}
                                            </span>
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            <ModalActions
                onClose={onClose}
                onSave={() => void save()}
                saving={saving}
                saveLabel={system ? '关闭' : existing ? '保存权限' : '创建角色'}
                hideCancel={system}
            />
        </Modal>
    );
}

function groupPermissions(items: PermissionPolicyRecord[]) {
    const localizedItems = items.map((item, index) => ({
        name: item.code,
        display: {
            label: item.name,
            description: item.description,
            group: item.group,
            groupLabel: item.group,
            order: item.sensitive ? 1000 + index : index,
        },
    }));
    const groups = new Map<string, typeof localizedItems>();
    localizedItems.forEach(item => {
        const key = item.display.group;
        groups.set(key, [...(groups.get(key) ?? []), item]);
    });
    return [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
        .map(([name, values]) => ({
            name,
            label: values[0]?.display.groupLabel ?? '其他权限',
            items: values.sort((a, b) => a.display.order - b.display.order),
        }));
}
function isSystemRole(role: RoleRecord) {
    return role.code === '__super_admin_role__' || role.permissions.includes('SuperAdmin');
}
function includesSearch(value: string, search: string) {
    return !search.trim() || value.toLowerCase().includes(search.trim().toLowerCase());
}
function TabButton({
    active,
    onClick,
    icon,
    children,
}: {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold ${active ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
        >
            {icon}
            {children}
        </button>
    );
}
function Modal({
    title,
    description,
    wide = false,
    onClose,
    children,
}: {
    title: string;
    description?: string;
    wide?: boolean;
    onClose: () => void;
    children: React.ReactNode;
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
            <AccessibleDialogSurface
                accessibleName={title}
                onRequestClose={onClose}
                className={`max-h-[94vh] w-full overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}
            >
                <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                        <h2 className="font-bold text-slate-900">{title}</h2>
                        {description && (
                            <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
                        )}
                    </div>
                    <button type="button" onClick={onClose} className="p-1 text-slate-400" aria-label="关闭">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                {children}
            </AccessibleDialogSurface>
        </div>
    );
}
function ModalActions({
    onClose,
    onSave,
    saving,
    saveLabel,
    hideCancel = false,
}: {
    onClose: () => void;
    onSave: () => void;
    saving: boolean;
    saveLabel: string;
    hideCancel?: boolean;
}) {
    return (
        <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4">
            {!hideCancel && (
                <button type="button" onClick={onClose} disabled={saving} className={secondaryButton}>
                    取消
                </button>
            )}
            <button type="button" onClick={onSave} disabled={saving} className={primaryButton}>
                {saving && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                {saveLabel}
            </button>
        </div>
    );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block text-xs font-bold text-slate-700">
            <span className="mb-1.5 block">{label}</span>
            {children}
        </label>
    );
}
function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
    return (
        <tr>
            <td colSpan={colSpan} className="p-12 text-center text-xs text-slate-400">
                {text}
            </td>
        </tr>
    );
}
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="flex min-h-96 flex-col items-center justify-center rounded-xl border border-rose-200 bg-white p-6 text-center">
            <AlertCircle className="h-8 w-8 text-rose-500" />
            <h2 className="mt-3 text-sm font-bold text-slate-800">员工与权限加载失败</h2>
            <p className="mt-1 max-w-lg text-xs text-rose-600">{toUserFacingError(message)}</p>
            <button type="button" onClick={onRetry} className={`${secondaryButton} mt-4`}>
                重试
            </button>
        </div>
    );
}
function Message({
    kind,
    onClose,
    children,
}: {
    kind: 'success' | 'error';
    onClose: () => void;
    children: React.ReactNode;
}) {
    const success = kind === 'success';
    return (
        <div
            className={`flex items-center gap-2 rounded-xl border p-3 text-xs ${success ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}
        >
            {success ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <span className="flex-1">{children}</span>
            <button type="button" onClick={onClose} aria-label="关闭">
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
function errorText(error: unknown) {
    return toUserFacingError(error, '员工与权限操作失败，请稍后重试');
}
const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400';
const primaryButton =
    'flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton =
    'flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const iconButton = 'inline-flex rounded-lg p-2 text-slate-500 hover:bg-slate-100';
const theadClass = 'border-b border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-500';
