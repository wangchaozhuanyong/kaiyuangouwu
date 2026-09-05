import { useApolloClient, useQuery } from '@apollo/client/react';
import { Download, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { clearAuthSession } from '../../apollo';
import {
    ADMIN_BEGIN_SETUP,
    ADMIN_CONFIRM_SETUP,
    ADMIN_DISABLE_TWO_FACTOR,
    ADMIN_REGENERATE_RECOVERY_CODES,
    ADMIN_TWO_FACTOR_STATUS,
    type AdminTwoFactorSetup,
    type AdminTwoFactorStatus,
} from '../../graphql/admin-security.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';

const inputClass =
    'mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const buttonClass =
    'rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';

export function TwoFactorSecurityCard() {
    const client = useApolloClient();
    const navigate = useNavigate();
    const query = useQuery<{ adminTwoFactorStatus: AdminTwoFactorStatus }>(ADMIN_TWO_FACTOR_STATUS, {
        fetchPolicy: 'no-cache',
    });
    const status = query.data?.adminTwoFactorStatus;
    const [action, setAction] = useState<'setup' | 'disable' | 'recovery' | null>(null);
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    const [setup, setSetup] = useState<AdminTwoFactorSetup | null>(null);
    const [qrImage, setQrImage] = useState('');
    const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
    const [saved, setSaved] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const recoveryDialog = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        if (!recoveryCodes.length) return;
        recoveryDialog.current?.showModal();
        const preventClose = (event: BeforeUnloadEvent) => {
            event.preventDefault();
        };
        window.addEventListener('beforeunload', preventClose);
        return () => window.removeEventListener('beforeunload', preventClose);
    }, [recoveryCodes.length]);

    const reset = () => {
        setAction(null);
        setPassword('');
        setCode('');
        setSetup(null);
        setQrImage('');
        setError('');
    };

    const goToLogin = async () => {
        clearAuthSession();
        // Clear cached account data after the one-time recovery codes have been saved.
        navigate('/login', { replace: true });
        await client.clearStore();
    };

    const showRecoveryCodes = (codes: string[]) => {
        clearAuthSession();
        reset();
        setSaved(false);
        setRecoveryCodes(codes);
    };

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        try {
            const variables = { password, code: code.trim() };
            if (action === 'setup' && !setup) {
                const result = await client.mutate<{ adminBeginTwoFactorSetup: AdminTwoFactorSetup }>({
                    mutation: ADMIN_BEGIN_SETUP,
                    variables,
                    fetchPolicy: 'no-cache',
                });
                if (!result.data) throw new Error('未收到绑定资料，请重试');
                const nextSetup = result.data.adminBeginTwoFactorSetup;
                setSetup(nextSetup);
                setCode('');
                // The QR image is generated locally; secrets never go to a third-party QR service.
                try {
                    setQrImage(await QRCode.toDataURL(nextSetup.otpauthUri, { width: 240, margin: 2 }));
                } catch {
                    setQrImage('');
                }
            } else if (action === 'setup') {
                const result = await client.mutate<{
                    adminConfirmTwoFactorSetup: { recoveryCodes: string[] };
                }>({
                    mutation: ADMIN_CONFIRM_SETUP,
                    variables,
                    fetchPolicy: 'no-cache',
                });
                if (!result.data) throw new Error('未收到恢复码。请重新登录后，在账号安全中重新生成恢复码');
                showRecoveryCodes(result.data.adminConfirmTwoFactorSetup.recoveryCodes);
            } else if (action === 'disable') {
                await client.mutate({
                    mutation: ADMIN_DISABLE_TWO_FACTOR,
                    variables,
                    fetchPolicy: 'no-cache',
                });
                reset();
                await goToLogin();
            } else if (action === 'recovery') {
                const result = await client.mutate<{
                    adminRegenerateTwoFactorRecoveryCodes: { recoveryCodes: string[] };
                }>({
                    mutation: ADMIN_REGENERATE_RECOVERY_CODES,
                    variables,
                    fetchPolicy: 'no-cache',
                });
                if (!result.data) throw new Error('未收到恢复码，请重新登录后重试');
                showRecoveryCodes(result.data.adminRegenerateTwoFactorRecoveryCodes.recoveryCodes);
            }
        } catch (cause) {
            setError(
                toUserFacingError(cause, '安全设置操作失败，请重试；若操作已生效，请重新登录后检查状态'),
            );
        } finally {
            setBusy(false);
        }
    };

    const downloadRecoveryCodes = () => {
        const blob = new Blob(
            [
                `Vendure 管理后台 2FA 恢复码\n每个只能使用一次，请离线妥善保存。\n\n${recoveryCodes.join('\n')}\n`,
            ],
            { type: 'text/plain;charset=utf-8' },
        );
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'vendure-2fa-recovery-codes.txt';
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    if (recoveryCodes.length)
        return (
            <dialog
                ref={recoveryDialog}
                onCancel={event => event.preventDefault()}
                className="fixed inset-0 m-0 h-screen max-h-none w-screen max-w-none overflow-y-auto bg-slate-100 p-5 sm:p-10"
                aria-modal="true"
                aria-labelledby="recovery-title"
            >
                <section className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-lg sm:p-8">
                    <ShieldCheck className="h-8 w-8 text-emerald-600" />
                    <h2 id="recovery-title" className="mt-4 text-xl font-bold">
                        请保存一次性恢复码
                    </h2>
                    <p className="mt-3 text-sm leading-6 text-slate-600">
                        安全设置已生效，旧登录会话已退出。这些恢复码只展示这一次；验证器丢失时可配合密码登录。请保存到安全位置。
                    </p>
                    <ul className="my-5 space-y-2 rounded-xl bg-slate-50 p-4 font-mono text-xs sm:text-sm">
                        {recoveryCodes.map(value => (
                            <li key={value} className="break-all select-all">
                                {value}
                            </li>
                        ))}
                    </ul>
                    <button
                        type="button"
                        onClick={downloadRecoveryCodes}
                        className="flex items-center gap-2 text-sm font-semibold text-blue-700"
                    >
                        <Download className="h-4 w-4" /> 下载恢复码
                    </button>
                    <label className="my-5 flex items-start gap-3 text-sm">
                        <input
                            type="checkbox"
                            checked={saved}
                            onChange={event => setSaved(event.target.checked)}
                            className="mt-1"
                        />
                        我已妥善保存恢复码
                    </label>
                    <button
                        type="button"
                        disabled={!saved}
                        onClick={() => void goToLogin()}
                        className={buttonClass}
                    >
                        返回登录
                    </button>
                    <p className="mt-4 text-xs text-slate-500">
                        动态码已用于确认绑定时，请等待验证器生成下一枚动态码再登录。
                    </p>
                </section>
            </dialog>
        );

    return (
        <section
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
            aria-labelledby="two-factor-title"
            aria-busy={busy || query.loading}
        >
            <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <h2 id="two-factor-title" className="text-sm font-bold text-slate-900">
                    账号安全 · 验证器 2FA
                </h2>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">
                开启后，登录需要密码和验证器动态码。不需要手机号或短信。
            </p>
            {query.loading && (
                <p role="status" className="mt-4 text-sm">
                    正在读取安全状态…
                </p>
            )}
            {query.error && (
                <div role="alert" className="mt-4 text-sm text-red-700">
                    安全状态读取失败。
                    <button type="button" onClick={() => void query.refetch()} className="ml-2 underline">
                        重试
                    </button>
                </div>
            )}
            {status && (
                <>
                    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
                        <span
                            className={`rounded-full px-3 py-1 font-bold ${status.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}
                        >
                            {status.enabled ? '已开启' : '未开启'}
                        </span>
                        {status.enabled && (
                            <span className="text-slate-500">
                                剩余恢复码：{status.recoveryCodesRemaining} 个
                            </span>
                        )}
                        {status.enabledAt && (
                            <span className="text-slate-500">
                                开启时间：{new Date(status.enabledAt).toLocaleString('zh-CN')}
                            </span>
                        )}
                    </div>
                    {!status.available && (
                        <p role="alert" className="mt-4 text-sm text-amber-700">
                            验证器 2FA 暂不可用，请联系系统管理员完成安全配置。
                        </p>
                    )}
                    {!action && status.available && (
                        <div className="mt-5 flex flex-wrap gap-3">
                            <button type="button" onClick={() => setAction('setup')} className={buttonClass}>
                                {status.enabled ? '更换验证器' : '开启 2FA'}
                            </button>
                            {status.enabled && (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => setAction('recovery')}
                                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    >
                                        重新生成恢复码
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setAction('disable')}
                                        className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700"
                                    >
                                        关闭 2FA
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                </>
            )}
            {action && (
                <form onSubmit={submit} className="mt-5 space-y-4">
                    <p className="text-sm font-semibold">
                        {action === 'disable'
                            ? '确认关闭 2FA'
                            : action === 'recovery'
                              ? '重新生成恢复码'
                              : setup
                                ? '添加验证器并确认'
                                : status?.enabled
                                  ? '验证身份以更换验证器'
                                  : '验证身份以开启 2FA'}
                    </p>
                    {(action === 'disable' || action === 'recovery') && (
                        <p className="text-xs leading-5 text-amber-700">
                            {action === 'disable'
                                ? '关闭后将只使用账号密码登录。'
                                : '重新生成后，全部旧恢复码立即失效。'}
                            操作成功后需要重新登录。
                        </p>
                    )}
                    {setup && (
                        <div className="rounded-lg bg-slate-50 p-4">
                            <p className="text-xs leading-5 text-slate-600">
                                在验证器中扫描二维码，或手动添加下方密钥。绑定有效期 10 分钟。
                            </p>
                            {qrImage && (
                                <img
                                    src={qrImage}
                                    width={240}
                                    height={240}
                                    alt="用于添加后台登录验证器的二维码"
                                    className="mx-auto my-3 max-w-full"
                                />
                            )}
                            <p className="mt-3 text-xs font-bold">手动添加密钥</p>
                            <code className="mt-2 block break-all select-all text-sm">{setup.secret}</code>
                            <p className="mt-2 text-xs text-slate-500">
                                类型：基于时间；6 位动态码，每 30 秒更新。
                            </p>
                        </div>
                    )}
                    <label className="block text-xs font-semibold">
                        当前登录密码
                        <input
                            type="password"
                            autoComplete="current-password"
                            required
                            value={password}
                            onChange={event => setPassword(event.target.value)}
                            disabled={busy}
                            className={inputClass}
                        />
                    </label>
                    {(status?.enabled || setup) && (
                        <label className="block text-xs font-semibold">
                            {setup ? '新验证器的 6 位动态码' : '2FA 动态码或一次性恢复码'}
                            <input
                                type="text"
                                autoComplete="one-time-code"
                                inputMode={setup ? 'numeric' : 'text'}
                                maxLength={setup ? 6 : 64}
                                pattern={setup ? '[0-9]{6}' : undefined}
                                required
                                value={code}
                                onChange={event => setCode(event.target.value)}
                                disabled={busy}
                                spellCheck={false}
                                className={inputClass}
                            />
                        </label>
                    )}
                    {error && (
                        <p role="alert" className="text-sm text-red-700">
                            {error}
                        </p>
                    )}
                    <div className="flex flex-wrap gap-3">
                        <button type="submit" disabled={busy} className={buttonClass}>
                            {busy
                                ? '正在验证…'
                                : action === 'disable'
                                  ? '确认关闭并退出登录'
                                  : action === 'recovery'
                                    ? '生成新的恢复码'
                                    : setup
                                      ? '确认绑定'
                                      : '下一步'}
                        </button>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={reset}
                            className="px-3 py-2 text-sm text-slate-500"
                        >
                            取消
                        </button>
                    </div>
                </form>
            )}
        </section>
    );
}
