import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    CheckCircle2,
    KeyRound,
    LockKeyhole,
    Mail,
    RefreshCw,
    Save,
    ShieldCheck,
    User,
} from 'lucide-react';
import { useState } from 'react';
import { sensitiveActionContext } from '../../apollo';
import {
    ACTIVE_ADMINISTRATOR_PROFILE_QUERY,
    UPDATE_ACTIVE_ADMINISTRATOR_MUTATION,
    type ActiveAdministratorProfile,
    type ActiveAdministratorProfileData,
    type UpdateActiveAdministratorData,
} from '../../graphql/auth.graphql';
import { getChannelDisplayName } from '../../utils/channel-display';
import { isStrongAdministratorPassword, PASSWORD_REQUIREMENT } from '../../utils/password';
import { getRoleLabel } from '../../utils/status-labels';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatDateTime } from '../Sales/sales-utils';

interface UpdateActiveAdministratorVariables {
    input: {
        firstName?: string;
        lastName?: string;
        emailAddress?: string;
        password?: string;
    };
}

export function ProfileModule() {
    const query = useQuery<ActiveAdministratorProfileData>(ACTIVE_ADMINISTRATOR_PROFILE_QUERY, {
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
    });

    if (query.loading && !query.data) {
        return (
            <div className="h-full overflow-y-auto bg-slate-50 p-6 sm:p-8" aria-busy="true">
                <div className="mx-auto max-w-5xl space-y-5">
                    <div className="h-20 animate-pulse rounded-xl bg-slate-200" />
                    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                        <div className="h-[430px] animate-pulse rounded-xl bg-slate-200" />
                        <div className="h-[430px] animate-pulse rounded-xl bg-slate-200" />
                    </div>
                </div>
            </div>
        );
    }

    if (query.error && !query.data) {
        return (
            <div className="flex h-full items-center justify-center bg-slate-50 p-6">
                <div className="max-w-lg rounded-xl border border-rose-200 bg-white p-6 text-center shadow-xs">
                    <AlertCircle className="mx-auto h-8 w-8 text-rose-500" />
                    <h1 className="mt-3 text-base font-bold text-slate-900">个人资料加载失败</h1>
                    <p className="mt-2 text-xs text-slate-500">
                        {toUserFacingError(query.error, '个人资料读取失败，请稍后重试')}
                    </p>
                    <button
                        type="button"
                        onClick={() => void query.refetch()}
                        className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
                    >
                        <RefreshCw className="h-3.5 w-3.5" /> 重试
                    </button>
                </div>
            </div>
        );
    }

    const profile = query.data?.activeAdministrator;
    if (!profile) {
        return (
            <div className="flex h-full items-center justify-center bg-slate-50 p-6">
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
                    <User className="mx-auto h-8 w-8 text-amber-600" />
                    <h1 className="mt-3 text-base font-bold text-amber-900">当前登录会话没有管理员资料</h1>
                    <p className="mt-1 text-xs text-amber-700">请重新登录后再试。</p>
                </div>
            </div>
        );
    }

    return (
        <ProfileContent
            key={`${profile.id}-${profile.updatedAt}`}
            profile={profile}
            onUpdated={query.refetch}
        />
    );
}

function ProfileContent({
    profile,
    onUpdated,
}: {
    profile: ActiveAdministratorProfile;
    onUpdated: () => Promise<unknown>;
}) {
    const [firstName, setFirstName] = useState(profile.firstName);
    const [lastName, setLastName] = useState(profile.lastName);
    const [emailAddress, setEmailAddress] = useState(profile.emailAddress);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [notice, setNotice] = useState('');
    const [profileError, setProfileError] = useState('');
    const [passwordError, setPasswordError] = useState('');

    const [updateProfile, { loading: savingProfile }] = useMutation<
        UpdateActiveAdministratorData,
        UpdateActiveAdministratorVariables
    >(UPDATE_ACTIVE_ADMINISTRATOR_MUTATION);
    const [updatePassword, { loading: savingPassword }] = useMutation<
        UpdateActiveAdministratorData,
        UpdateActiveAdministratorVariables
    >(UPDATE_ACTIVE_ADMINISTRATOR_MUTATION);

    const fullName = [lastName, firstName].filter(Boolean).join('') || profile.user.identifier;
    const initials = `${lastName.charAt(0)}${firstName.charAt(0)}` || '管';
    const channels = [
        ...new Set(
            profile.user.roles.flatMap(role =>
                role.channels.map(channel => getChannelDisplayName(channel.code)),
            ),
        ),
    ];

    const showNotice = (message: string) => {
        setNotice(message);
        window.setTimeout(() => setNotice(''), 3500);
    };

    const handleSaveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setProfileError('');
        const normalizedFirstName = firstName.trim();
        const normalizedLastName = lastName.trim();
        const normalizedEmail = emailAddress.trim();
        if (!normalizedFirstName || !normalizedLastName || !normalizedEmail) {
            setProfileError('姓名和登录邮箱不能为空');
            return;
        }
        if (!normalizedEmail.includes('@')) {
            setProfileError('请输入有效的电子邮箱地址');
            return;
        }
        try {
            await updateProfile({
                variables: {
                    input: {
                        firstName: normalizedFirstName,
                        lastName: normalizedLastName,
                        emailAddress: normalizedEmail,
                    },
                },
            });
            await onUpdated();
            showNotice('个人资料已保存');
        } catch (error) {
            setProfileError(toUserFacingError(error, '个人资料保存失败，请稍后重试'));
        }
    };

    const handleChangePassword = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setPasswordError('');
        if (!currentPassword) {
            setPasswordError('请输入当前登录密码进行身份验证');
            return;
        }
        if (!isStrongAdministratorPassword(newPassword)) {
            setPasswordError(`${PASSWORD_REQUIREMENT}，且不能包含换行符`);
            return;
        }
        if (newPassword !== confirmPassword) {
            setPasswordError('两次输入的新密码不一致');
            return;
        }
        try {
            await updatePassword({
                variables: { input: { password: newPassword } },
                context: sensitiveActionContext(currentPassword),
            });
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            await onUpdated();
            showNotice('登录密码已更新，请妥善保管新密码');
        } catch (error) {
            setPasswordError(toUserFacingError(error, '密码更新失败，请稍后重试'));
        }
    };

    return (
        <div className="h-full overflow-y-auto bg-slate-50">
            <header className="border-b border-slate-200 bg-white px-5 py-5 sm:px-8">
                <div className="mx-auto flex max-w-5xl items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white shadow-sm">
                        {initials}
                    </div>
                    <div className="min-w-0">
                        <h1 className="truncate text-xl font-bold text-slate-900">{fullName}</h1>
                        <p className="mt-0.5 truncate text-xs text-slate-500">{profile.emailAddress}</p>
                    </div>
                </div>
            </header>

            <main className="px-5 py-6 sm:px-8">
                <div className="mx-auto max-w-5xl space-y-5">
                    {notice && (
                        <div
                            role="status"
                            className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-700"
                        >
                            <CheckCircle2 className="h-4 w-4" /> {notice}
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                        <div className="space-y-5">
                            <form
                                onSubmit={handleSaveProfile}
                                className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
                            >
                                <div className="flex items-center gap-2">
                                    <User className="h-4 w-4 text-blue-600" />
                                    <h2 className="text-sm font-bold text-slate-900">基本资料</h2>
                                </div>
                                <p className="mt-1 text-[11px] text-slate-500">
                                    姓名和邮箱会用于后台账号识别与登录。
                                </p>
                                {profileError && <InlineError message={profileError} />}
                                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                                    <Field
                                        label="姓"
                                        value={lastName}
                                        onChange={setLastName}
                                        autoComplete="family-name"
                                    />
                                    <Field
                                        label="名"
                                        value={firstName}
                                        onChange={setFirstName}
                                        autoComplete="given-name"
                                    />
                                    <div className="sm:col-span-2">
                                        <Field
                                            label="登录邮箱"
                                            value={emailAddress}
                                            onChange={setEmailAddress}
                                            type="email"
                                            autoComplete="email"
                                            icon={Mail}
                                        />
                                        <p className="mt-1 text-[11px] text-slate-400">
                                            修改后，下一次登录请使用新邮箱。
                                        </p>
                                    </div>
                                </div>
                                <div className="mt-5 flex justify-end border-t border-slate-100 pt-4">
                                    <button
                                        type="submit"
                                        disabled={savingProfile}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {savingProfile ? (
                                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <Save className="h-3.5 w-3.5" />
                                        )}{' '}
                                        保存资料
                                    </button>
                                </div>
                            </form>

                            <form
                                onSubmit={handleChangePassword}
                                className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
                            >
                                <div className="flex items-center gap-2">
                                    <LockKeyhole className="h-4 w-4 text-violet-600" />
                                    <h2 className="text-sm font-bold text-slate-900">修改登录密码</h2>
                                </div>
                                <p className="mt-1 text-[11px] text-slate-500">
                                    为保护账号安全，修改密码前需要验证当前登录密码。
                                </p>
                                {passwordError && <InlineError message={passwordError} />}
                                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                                    <div className="sm:col-span-2">
                                        <Field
                                            label="当前登录密码"
                                            value={currentPassword}
                                            onChange={setCurrentPassword}
                                            type="password"
                                            autoComplete="current-password"
                                        />
                                    </div>
                                    <Field
                                        label="新密码"
                                        value={newPassword}
                                        onChange={setNewPassword}
                                        type="password"
                                        autoComplete="new-password"
                                    />
                                    <Field
                                        label="确认新密码"
                                        value={confirmPassword}
                                        onChange={setConfirmPassword}
                                        type="password"
                                        autoComplete="new-password"
                                    />
                                </div>
                                <p className="mt-2 text-[11px] text-slate-400">{PASSWORD_REQUIREMENT}。</p>
                                <div className="mt-5 flex justify-end border-t border-slate-100 pt-4">
                                    <button
                                        type="submit"
                                        disabled={savingPassword}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {savingPassword ? (
                                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <KeyRound className="h-3.5 w-3.5" />
                                        )}{' '}
                                        更新密码
                                    </button>
                                </div>
                            </form>
                        </div>

                        <aside className="space-y-5">
                            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                                <div className="flex items-center gap-2">
                                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                                    <h2 className="text-sm font-bold text-slate-900">账号状态</h2>
                                </div>
                                <dl className="mt-4 space-y-3 text-xs">
                                    <InfoRow label="账号 ID" value={profile.id} mono />
                                    <InfoRow label="登录标识" value={profile.user.identifier} mono />
                                    <InfoRow
                                        label="账号验证"
                                        value={profile.user.verified ? '已验证' : '未验证'}
                                    />
                                    <InfoRow
                                        label="最近登录"
                                        value={formatDateTime(profile.user.lastLogin)}
                                    />
                                    <InfoRow label="创建时间" value={formatDateTime(profile.createdAt)} />
                                </dl>
                            </section>

                            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                                <h2 className="text-sm font-bold text-slate-900">认证方式</h2>
                                <div className="mt-3 space-y-2">
                                    {profile.user.authenticationMethods.length === 0 ? (
                                        <p className="text-xs text-slate-400">服务器未返回认证方式</p>
                                    ) : (
                                        profile.user.authenticationMethods.map(method => (
                                            <div
                                                key={method.id}
                                                className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"
                                            >
                                                <span className="font-bold text-slate-700">
                                                    {method.strategy === 'native' ? '密码' : method.strategy}
                                                </span>
                                                <span className="text-[11px] text-slate-400">
                                                    {formatDateTime(method.createdAt)}
                                                </span>
                                            </div>
                                        ))
                                    )}
                                </div>
                                <p className="mt-3 text-[11px] leading-5 text-slate-400">
                                    这里只显示服务端实际启用的认证策略。
                                </p>
                            </section>

                            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                                <h2 className="text-sm font-bold text-slate-900">角色与店铺范围</h2>
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                    {profile.user.roles.length === 0 ? (
                                        <span className="text-xs text-slate-400">未分配角色</span>
                                    ) : (
                                        profile.user.roles.map(role => (
                                            <span
                                                key={role.id}
                                                title={role.code}
                                                className="rounded-md bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700"
                                            >
                                                {getRoleLabel(role)}
                                            </span>
                                        ))
                                    )}
                                </div>
                                <div className="mt-4 border-t border-slate-100 pt-3">
                                    <p className="text-[11px] font-bold text-slate-500">可访问店铺/渠道</p>
                                    <p className="mt-1 text-xs text-slate-700">
                                        {channels.length > 0 ? channels.join('、') : '未分配渠道'}
                                    </p>
                                </div>
                            </section>
                        </aside>
                    </div>
                </div>
            </main>
        </div>
    );
}

function Field({
    label,
    value,
    onChange,
    type = 'text',
    autoComplete,
    icon: Icon,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    type?: 'text' | 'email' | 'password';
    autoComplete: string;
    icon?: typeof Mail;
}) {
    return (
        <label className="block text-xs font-bold text-slate-600">
            {label}
            <span className="relative mt-1.5 block">
                {Icon && <Icon className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />}
                <input
                    required
                    type={type}
                    value={value}
                    onChange={event => onChange(event.target.value)}
                    autoComplete={autoComplete}
                    className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${Icon ? 'pl-9' : ''}`}
                />
            </span>
        </label>
    );
}

function InlineError({ message }: { message: string }) {
    return (
        <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700"
        >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {message}
        </div>
    );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="flex items-start justify-between gap-3">
            <dt className="shrink-0 text-slate-400">{label}</dt>
            <dd className={`break-all text-right text-slate-700 ${mono ? 'font-mono text-[11px]' : ''}`}>
                {value}
            </dd>
        </div>
    );
}
