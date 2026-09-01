import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
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
import { useEffect, useMemo, useRef, useState } from 'react';
import { sensitiveActionContext } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import {
    CREATE_ADMINISTRATOR_MUTATION,
    CREATE_ROLE_MUTATION,
    DELETE_ADMINISTRATOR_MUTATION,
    DELETE_ROLE_MUTATION,
    TEAM_MANAGEMENT_QUERY,
    UPDATE_ADMINISTRATOR_MUTATION,
    UPDATE_ROLE_MUTATION,
    type AdministratorRecord,
    type RoleRecord,
    type TeamManagementResult,
} from '../../graphql/management.graphql';
import { useUrlTab } from '../../hooks/use-url-tab';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatDateTime } from '../Sales/sales-utils';

type Tab = 'MEMBERS' | 'ROLES';
const ROLE_TABS = { members: 'MEMBERS', roles: 'ROLES' } as const;

export function RolesModule() {
    const [tab, setTab] = useUrlTab<Tab>(ROLE_TABS, 'members');
    const [search, setSearch] = useState('');
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const [roleEditor, setRoleEditor] = useState<RoleRecord | 'NEW' | null>(null);
    const [memberEditor, setMemberEditor] = useState<AdministratorRecord | 'NEW' | null>(null);
    const loadingAllRecordsRef = useRef(false);
    const query = useQuery<TeamManagementResult>(TEAM_MANAGEMENT_QUERY, {
        variables: {
            administratorOptions: { skip: 0, take: 100, sort: { createdAt: 'DESC' } },
            roleOptions: { skip: 0, take: 100, sort: { createdAt: 'ASC' } },
            channelOptions: { skip: 0, take: 100, sort: { code: 'ASC' } },
        },
        fetchPolicy: 'cache-and-network',
    });
    const { data: teamData, error: teamError, fetchMore: fetchMoreTeamData, loading: teamLoading } = query;

    useEffect(() => {
        const data = teamData;
        if (!data || teamLoading || teamError || loadingAllRecordsRef.current) return;
        const administratorCount = data.administrators.items.length;
        const roleCount = data.roles.items.length;
        const channelCount = data.channels.items.length;
        if (
            administratorCount >= data.administrators.totalItems &&
            roleCount >= data.roles.totalItems &&
            channelCount >= data.channels.totalItems
        )
            return;
        loadingAllRecordsRef.current = true;
        const mergeById = <T extends { id: string }>(current: T[], next: T[]) => [
            ...new Map([...current, ...next].map(item => [item.id, item])).values(),
        ];
        void fetchMoreTeamData({
            variables: {
                administratorOptions: { skip: administratorCount, take: 100, sort: { createdAt: 'DESC' } },
                roleOptions: { skip: roleCount, take: 100, sort: { createdAt: 'ASC' } },
                channelOptions: { skip: channelCount, take: 100, sort: { code: 'ASC' } },
            },
            updateQuery: (previous, { fetchMoreResult }) => ({
                ...previous,
                administrators: {
                    ...fetchMoreResult.administrators,
                    items: mergeById(previous.administrators.items, fetchMoreResult.administrators.items),
                },
                roles: {
                    ...fetchMoreResult.roles,
                    items: mergeById(previous.roles.items, fetchMoreResult.roles.items),
                },
                channels: {
                    ...fetchMoreResult.channels,
                    items: mergeById(previous.channels.items, fetchMoreResult.channels.items),
                },
            }),
        })
            .catch(fetchError => {
                setActionError(toUserFacingError(fetchError, '员工、角色或渠道数据未能全部加载'));
            })
            .finally(() => {
                loadingAllRecordsRef.current = false;
            });
    }, [fetchMoreTeamData, teamData, teamError, teamLoading]);

    const roles = query.data?.roles.items ?? [];
    const members = query.data?.administrators.items ?? [];
    const filteredMembers = members.filter(item =>
        includesSearch(
            `${item.firstName} ${item.lastName} ${item.emailAddress} ${item.user.identifier} ${item.user.roles.map(role => `${role.code} ${role.description}`).join(' ')}`,
            search,
        ),
    );
    const filteredRoles = roles.filter(item =>
        includesSearch(
            `${item.code} ${item.description} ${item.channels.map(channel => channel.code).join(' ')} ${item.permissions.join(' ')}`,
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
                    </div>
                </div>
            </header>
            <main className="w-full max-w-none flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
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
                {query.loading && !query.data ? (
                    <LoadingState />
                ) : query.error ? (
                    <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
                ) : tab === 'MEMBERS' ? (
                    <MembersTable
                        members={filteredMembers}
                        activeId={query.data?.activeAdministrator?.id ?? null}
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
                        onChanged={completed}
                        onError={setActionError}
                    />
                )}
            </main>
            {memberEditor && (
                <MemberEditor
                    value={memberEditor}
                    roles={roles}
                    onClose={() => setMemberEditor(null)}
                    onCompleted={completed}
                    onError={setActionError}
                />
            )}
            {roleEditor && query.data && (
                <RoleEditor
                    value={roleEditor}
                    roles={roles}
                    channels={query.data.channels.items}
                    permissionDefinitions={query.data.globalSettings.serverConfig.permissions}
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
    onEdit,
    onChanged,
    onError,
}: {
    members: AdministratorRecord[];
    activeId: string | null;
    onEdit: (member: AdministratorRecord) => void;
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [remove, state] = useMutation<{ deleteAdministrator: { result: string; message: string | null } }>(
        DELETE_ADMINISTRATOR_MUTATION,
    );
    const destroy = async (member: AdministratorRecord) => {
        if (member.id === activeId) return;
        const confirmation = await requestConfirmation({
            title: `删除员工账号“${member.firstName}${member.lastName}”？`,
            description: `${member.emailAddress}\n删除后该账号将立即无法登录管理后台。`,
            confirmLabel: '确认删除',
            tone: 'danger',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        try {
            const response = await remove({
                variables: { id: member.id },
                context: sensitiveActionContext(confirmation.currentPassword ?? ''),
            });
            const result = response.data?.deleteAdministrator;
            if (!result || result.result !== 'DELETED') throw new Error(result?.message || '删除失败');
            await onChanged('员工账号已删除');
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-xs">
                    <thead>
                        <tr className={theadClass}>
                            <th className="p-4">员工</th>
                            <th className="p-4">登录账号</th>
                            <th className="p-4">角色</th>
                            <th className="p-4">最近登录</th>
                            <th className="p-4">创建时间</th>
                            <th className="p-4 text-right">操作</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {members.map(member => (
                            <tr key={member.id} className="hover:bg-slate-50">
                                <td className="p-4">
                                    <div className="font-bold text-slate-900">
                                        {member.firstName}
                                        {member.lastName}
                                    </div>
                                    {member.id === activeId && (
                                        <span className="mt-1 inline-block rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">
                                            当前账号
                                        </span>
                                    )}
                                </td>
                                <td className="p-4">
                                    <div>{member.emailAddress}</div>
                                    <div className="mt-1 font-mono text-[9px] text-slate-400">
                                        {member.user.identifier}
                                    </div>
                                </td>
                                <td className="p-4">
                                    <div className="flex max-w-md flex-wrap gap-1">
                                        {member.user.roles.map(role => (
                                            <span
                                                key={role.id}
                                                className="rounded bg-slate-100 px-2 py-1 text-[10px] text-slate-600"
                                            >
                                                {role.description || role.code}
                                            </span>
                                        ))}
                                    </div>
                                </td>
                                <td className="p-4 text-slate-500">
                                    {member.user.lastLogin
                                        ? formatDateTime(member.user.lastLogin)
                                        : '从未登录'}
                                </td>
                                <td className="p-4 text-slate-400">{formatDateTime(member.createdAt)}</td>
                                <td className="p-4">
                                    <div className="flex justify-end gap-1">
                                        <button
                                            type="button"
                                            onClick={() => onEdit(member)}
                                            className={iconButton}
                                            aria-label="编辑"
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void destroy(member)}
                                            disabled={member.id === activeId || state.loading}
                                            className={`${iconButton} text-rose-600 disabled:opacity-30`}
                                            aria-label="删除"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {!members.length && <EmptyRow colSpan={6} text="没有符合条件的员工账号" />}
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
    onChanged,
    onError,
}: {
    roles: RoleRecord[];
    memberCount: (id: string) => number;
    onEdit: (role: RoleRecord) => void;
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [remove, state] = useMutation<{
        deleteRole: { result: string; message?: string | null };
    }>(DELETE_ROLE_MUTATION);
    const destroy = async (role: RoleRecord) => {
        if (isSystemRole(role)) return;
        const count = memberCount(role.id);
        const confirmation = await requestConfirmation({
            title: `删除角色“${role.description || role.code}”？`,
            description:
                count > 0
                    ? `当前仍有 ${count} 名员工关联此角色。后端会校验是否允许删除，请先确认员工仍有其它有效角色。`
                    : '删除后无法恢复，请输入当前管理员密码确认。',
            confirmLabel: '验证并删除',
            tone: 'danger',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        try {
            const response = await remove({
                variables: { id: role.id },
                context: sensitiveActionContext(confirmation.currentPassword ?? ''),
            });
            const result = response.data?.deleteRole;
            if (result?.result !== 'DELETED') throw new Error(result?.message || '角色删除失败');
            await onChanged('角色已删除');
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
                <table className="w-full min-w-[850px] text-left text-xs">
                    <thead>
                        <tr className={theadClass}>
                            <th className="p-4">角色</th>
                            <th className="p-4">代码</th>
                            <th className="p-4">渠道范围</th>
                            <th className="p-4">权限</th>
                            <th className="p-4">关联员工</th>
                            <th className="p-4 text-right">操作</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {roles.map(role => {
                            const system = isSystemRole(role);
                            return (
                                <tr key={role.id} className="hover:bg-slate-50">
                                    <td className="p-4">
                                        <div className="flex items-center gap-2 font-bold text-slate-900">
                                            <Shield
                                                className={`h-4 w-4 ${system ? 'text-emerald-600' : 'text-blue-600'}`}
                                            />
                                            {role.description || role.code}
                                        </div>
                                        {system && (
                                            <span className="mt-1 inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                                                系统保留
                                            </span>
                                        )}
                                    </td>
                                    <td className="p-4 font-mono text-[10px] text-slate-500">{role.code}</td>
                                    <td className="p-4 text-slate-600">
                                        {system
                                            ? '全部渠道'
                                            : role.channels.length
                                              ? role.channels.map(channel => channel.code).join('、')
                                              : '未限定渠道'}
                                    </td>
                                    <td className="p-4 font-mono font-bold text-blue-700">
                                        {role.permissions.length} 项
                                    </td>
                                    <td className="p-4">{memberCount(role.id)} 人</td>
                                    <td className="p-4">
                                        <div className="flex justify-end gap-1">
                                            <button
                                                type="button"
                                                onClick={() => onEdit(role)}
                                                className={secondaryButton}
                                            >
                                                {system ? '查看权限' : '配置权限'}
                                            </button>
                                            {!system && (
                                                <button
                                                    type="button"
                                                    disabled={state.loading}
                                                    onClick={() => void destroy(role)}
                                                    className={`${iconButton} text-rose-600 disabled:opacity-30`}
                                                    aria-label={`删除角色${role.description || role.code}`}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            )}
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
    onClose,
    onCompleted,
    onError,
}: {
    value: AdministratorRecord | 'NEW';
    roles: RoleRecord[];
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
    const [create, createState] = useMutation(CREATE_ADMINISTRATOR_MUTATION);
    const [update, updateState] = useMutation(UPDATE_ADMINISTRATOR_MUTATION);
    const saving = createState.loading || updateState.loading;
    const save = async () => {
        if (![firstName, lastName, emailAddress].every(item => item.trim()) || roleIds.length === 0)
            return onError('请填写姓名、邮箱并至少选择一个角色');
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
                            roleIds,
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
                            roleIds,
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
            <div className="mt-5">
                <div className="mb-2 text-xs font-bold text-slate-700">分配角色 *</div>
                <div className="grid gap-2 sm:grid-cols-2">
                    {roles.map(role => (
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
                                <strong className="block text-slate-800">
                                    {role.description || role.code}
                                </strong>
                                <span className="mt-1 block font-mono text-[9px] text-slate-400">
                                    {role.code}
                                </span>
                            </span>
                        </label>
                    ))}
                </div>
            </div>
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
    channels,
    permissionDefinitions,
    onClose,
    onCompleted,
    onError,
}: {
    value: RoleRecord | 'NEW';
    roles: RoleRecord[];
    channels: Array<{ id: string; code: string }>;
    permissionDefinitions: Array<{ name: string; description: string; assignable: boolean }>;
    onClose: () => void;
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const existing = value === 'NEW' ? null : value;
    const system = Boolean(existing && isSystemRole(existing));
    const [code, setCode] = useState(existing?.code ?? '');
    const [description, setDescription] = useState(existing?.description ?? '');
    const [channelIds, setChannelIds] = useState(existing?.channels.map(channel => channel.id) ?? []);
    const [permissions, setPermissions] = useState(existing?.permissions ?? []);
    const [create, createState] = useMutation(CREATE_ROLE_MUTATION);
    const [update, updateState] = useMutation(UPDATE_ROLE_MUTATION);
    const saving = createState.loading || updateState.loading;
    const groups = useMemo(
        () => groupPermissions(permissionDefinitions.filter(item => item.assignable)),
        [permissionDefinitions],
    );
    const save = async () => {
        if (system) return onClose();
        if (!code.trim() || !description.trim()) return onError('请填写角色名称和系统代码');
        if (!existing && roles.some(role => role.code.toLowerCase() === code.trim().toLowerCase()))
            return onError('角色代码已存在，请更换');
        try {
            const input = { code: code.trim(), description: description.trim(), channelIds, permissions };
            if (existing) {
                const confirmation = await requestConfirmation({
                    title: `保存角色“${existing.description || existing.code}”的权限变更？`,
                    description: '角色权限保存后会立即影响所有关联员工，请输入当前管理员密码。',
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
            await onCompleted(existing ? '角色权限已更新' : '角色已创建');
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
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="角色名称 *">
                    <input
                        value={description}
                        onChange={event => setDescription(event.target.value)}
                        disabled={system}
                        className={inputClass}
                        placeholder="例如：订单客服"
                    />
                </Field>
                <Field label="系统代码 *">
                    <input
                        value={code}
                        onChange={event => setCode(event.target.value)}
                        disabled={Boolean(existing)}
                        className={`${inputClass} font-mono`}
                        placeholder="order-support"
                    />
                </Field>
            </div>
            <div className="mt-5">
                <div className="mb-2 flex items-end justify-between">
                    <div>
                        <div className="text-xs font-bold text-slate-700">生效渠道</div>
                        <p className="mt-1 text-[10px] text-slate-400">不选择表示角色不限定具体渠道</p>
                    </div>
                    <span className="text-[10px] text-slate-400">已选 {channelIds.length}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                    {channels.map(channel => (
                        <label
                            key={channel.id}
                            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${channelIds.includes(channel.id) ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-600'}`}
                        >
                            <input
                                type="checkbox"
                                checked={channelIds.includes(channel.id)}
                                onChange={() =>
                                    setChannelIds(current =>
                                        current.includes(channel.id)
                                            ? current.filter(id => id !== channel.id)
                                            : [...current, channel.id],
                                    )
                                }
                                disabled={system}
                            />
                            {channel.code}
                        </label>
                    ))}
                </div>
            </div>
            <div className="mt-6 border-t border-slate-100 pt-5">
                <div className="mb-3 flex items-center justify-between">
                    <div>
                        <div className="text-xs font-bold text-slate-700">操作权限</div>
                        <p className="mt-1 text-[10px] text-slate-400">按业务对象分组，勾选后保存立即生效</p>
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
                                            <span className="block font-mono text-[10px] font-bold text-slate-700">
                                                {permissionLabel(item.name)}
                                            </span>
                                            <span className="mt-0.5 block text-[9px] leading-4 text-slate-400">
                                                {item.description}
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

function groupPermissions(items: Array<{ name: string; description: string; assignable: boolean }>) {
    const groups = new Map<string, typeof items>();
    items.forEach(item => {
        const key = permissionSubject(item.name);
        groups.set(key, [...(groups.get(key) ?? []), item]);
    });
    return [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
        .map(([name, values]) => ({
            name,
            label: subjectLabel(name),
            items: values.sort((a, b) => actionOrder(a.name) - actionOrder(b.name)),
        }));
}
function permissionSubject(name: string) {
    return name.replace(/^(Create|Read|Update|Delete)/, '') || 'Other';
}
function actionOrder(name: string) {
    const index = ['Read', 'Create', 'Update', 'Delete'].findIndex(prefix => name.startsWith(prefix));
    return index < 0 ? 99 : index;
}
function subjectLabel(subject: string) {
    const labels: Record<string, string> = {
        Administrator: '员工账号',
        ApiKey: 'API 密钥',
        Asset: '素材',
        Catalog: '商品目录',
        CatalogImport: '商品批量导入',
        Channel: '渠道',
        Collection: '集合',
        Country: '国家地区',
        Customer: '客户',
        CustomerGroup: '客户分组',
        Facet: '筛选属性',
        Order: '订单',
        PaymentMethod: '支付方式',
        Product: '商品',
        Promotion: '促销',
        Seller: '商家主体',
        Settings: '业务设置',
        ShippingMethod: '配送方式',
        StockLocation: '库存点',
        System: '系统运维',
        Tag: '标签',
        TaxCategory: '税种',
        TaxRate: '税率',
        Zone: '区域',
    };
    return labels[subject] ?? subject;
}
function permissionLabel(name: string) {
    const action = name.match(/^(Create|Read|Update|Delete)/)?.[1];
    const subject = permissionSubject(name);
    const actions: Record<string, string> = { Create: '新增', Read: '查看', Update: '修改', Delete: '删除' };
    return action ? `${actions[action]}${subjectLabel(subject)} · ${name}` : name;
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
function LoadingState() {
    return (
        <div className="flex min-h-96 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-500">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            正在读取员工与权限数据…
        </div>
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
