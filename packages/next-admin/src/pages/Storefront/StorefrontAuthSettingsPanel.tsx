import { ExternalLink, KeyRound, LoaderCircle } from 'lucide-react';
import { useState } from 'react';

import type { StorefrontAuthSettingsRecord } from '../../graphql/storefront.graphql';

const googleClientIdPattern = /^[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/iu;

export function StorefrontAuthSettingsPanel({
    value,
    disabled,
    saving,
    onSave,
}: {
    value: StorefrontAuthSettingsRecord;
    disabled: boolean;
    saving: boolean;
    onSave: (value: StorefrontAuthSettingsRecord) => Promise<void>;
}) {
    const [draft, setDraft] = useState(value);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const update = <K extends keyof StorefrontAuthSettingsRecord>(
        key: K,
        nextValue: StorefrontAuthSettingsRecord[K],
    ) => {
        setDraft(current => ({ ...current, [key]: nextValue }));
        setError('');
        setNotice('');
    };

    const save = async () => {
        const googleClientId = draft.googleClientId?.trim() || null;
        if (draft.googleEnabled && (!googleClientId || !googleClientIdPattern.test(googleClientId))) {
            setError('开启 Google 快捷登录前，请填写有效的 Google OAuth Web Client ID。');
            return;
        }
        setError('');
        setNotice('');
        try {
            await onSave({
                emailPasswordEnabled: draft.emailPasswordEnabled,
                emailAutoRegistrationEnabled: draft.emailAutoRegistrationEnabled,
                emailQuickRegistrationEnabled: draft.emailQuickRegistrationEnabled,
                googleEnabled: draft.googleEnabled,
                googleClientId,
            });
            setNotice('当前店铺的账号与登录设置已保存。');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '账号与登录设置保存失败，请重试。');
        }
    };

    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-start gap-3">
                <span className="mt-0.5 rounded-lg bg-blue-50 p-2 text-blue-600">
                    <KeyRound className="h-4 w-4" />
                </span>
                <div>
                    <h3 className="text-sm font-bold text-slate-900">账号与登录</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                        仅影响当前店铺。邮箱验证仍保持开启，Google Client ID 属于公开标识，不需要填写 Client
                        Secret。
                    </p>
                </div>
            </div>

            <div className="mt-5 divide-y divide-slate-100 rounded-lg border border-slate-200">
                <SwitchRow
                    label="邮箱密码注册与登录"
                    description="在登录页和注册页显示邮箱入口。"
                    checked={draft.emailPasswordEnabled}
                    disabled={disabled || saving}
                    onChange={checked => {
                        update('emailPasswordEnabled', checked);
                        if (!checked) {
                            setDraft(current => ({
                                ...current,
                                emailPasswordEnabled: false,
                                emailAutoRegistrationEnabled: false,
                                emailQuickRegistrationEnabled: false,
                            }));
                        }
                    }}
                />
                <SwitchRow
                    label="登录失败时尝试自动注册"
                    description="邮箱未注册时自动创建待验证账号；已注册邮箱仍不会暴露账号状态。"
                    checked={draft.emailAutoRegistrationEnabled}
                    disabled={disabled || saving || !draft.emailPasswordEnabled}
                    onChange={checked => update('emailAutoRegistrationEnabled', checked)}
                />
                <SwitchRow
                    label="邮箱快捷注册"
                    description="注册页只填写邮箱，点击验证邮件后再设置密码。"
                    checked={draft.emailQuickRegistrationEnabled}
                    disabled={disabled || saving || !draft.emailPasswordEnabled}
                    onChange={checked => update('emailQuickRegistrationEnabled', checked)}
                />
                <SwitchRow
                    label="Google 快捷注册与登录"
                    description="使用 Google Identity Services；新账号自动注册，已有同邮箱账号安全关联。"
                    checked={draft.googleEnabled}
                    disabled={disabled || saving}
                    onChange={checked => update('googleEnabled', checked)}
                />
            </div>

            <label className="mt-4 block text-xs font-bold text-slate-700" htmlFor="google-client-id">
                Google OAuth Web Client ID
            </label>
            <input
                id="google-client-id"
                value={draft.googleClientId ?? ''}
                disabled={disabled || saving}
                onChange={event => update('googleClientId', event.target.value)}
                placeholder="1234567890-xxxx.apps.googleusercontent.com"
                className="mt-2 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
            />
            <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700"
            >
                前往 Google Cloud 创建 OAuth Web Client ID
                <ExternalLink className="h-3 w-3" />
            </a>

            {error ? (
                <p className="mt-3 text-xs font-medium text-red-600" role="alert">
                    {error}
                </p>
            ) : null}
            {notice ? (
                <p className="mt-3 text-xs font-medium text-emerald-700" role="status">
                    {notice}
                </p>
            ) : null}

            <button
                type="button"
                disabled={disabled || saving}
                onClick={() => void save()}
                className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
                {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                {saving ? '保存中' : '保存账号设置'}
            </button>
        </section>
    );
}

function SwitchRow({
    label,
    description,
    checked,
    disabled,
    onChange,
}: {
    label: string;
    description: string;
    checked: boolean;
    disabled: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <div className="flex items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
                <strong className="block text-xs text-slate-800">{label}</strong>
                <small className="mt-1 block text-[11px] leading-4 text-slate-500">{description}</small>
            </div>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={label}
                disabled={disabled}
                onClick={() => onChange(!checked)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-slate-300'} disabled:cursor-not-allowed disabled:opacity-50`}
            >
                <span
                    className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`}
                />
            </button>
        </div>
    );
}
