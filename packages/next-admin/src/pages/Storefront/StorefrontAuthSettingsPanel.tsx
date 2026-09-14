import { ExternalLink, KeyRound, LoaderCircle } from 'lucide-react';
import { useState } from 'react';

import type { StorefrontAuthConfigurationRecord } from '../../graphql/storefront.graphql';

const googleClientIdPattern = /^[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/iu;

export type StorefrontStoreAuthSettingsInput = Pick<
    StorefrontAuthConfigurationRecord,
    | 'emailPasswordEnabled'
    | 'emailAutoRegistrationEnabled'
    | 'emailQuickRegistrationEnabled'
    | 'googleOverrideEnabled'
    | 'storeGoogleEnabled'
    | 'storeGoogleClientId'
>;

export interface StorefrontGooglePlatformSettingsInput {
    googleEnabled: boolean;
    googleClientId: string | null;
}

export function StorefrontAuthSettingsPanel({
    value,
    disabled,
    canEditPlatform,
    storeSaving,
    platformSaving,
    onSaveStore,
    onSavePlatform,
}: {
    value: StorefrontAuthConfigurationRecord;
    disabled: boolean;
    canEditPlatform: boolean;
    storeSaving: boolean;
    platformSaving: boolean;
    onSaveStore: (value: StorefrontStoreAuthSettingsInput) => Promise<void>;
    onSavePlatform: (value: StorefrontGooglePlatformSettingsInput) => Promise<void>;
}) {
    const [draft, setDraft] = useState(value);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const busy = storeSaving || platformSaving;

    const update = <K extends keyof StorefrontAuthConfigurationRecord>(
        key: K,
        nextValue: StorefrontAuthConfigurationRecord[K],
    ) => {
        setDraft(current => ({ ...current, [key]: nextValue }));
        setError('');
        setNotice('');
    };

    const saveStore = async () => {
        const storeGoogleClientId = draft.storeGoogleClientId?.trim() || null;
        if (
            draft.googleOverrideEnabled &&
            draft.storeGoogleEnabled &&
            (!storeGoogleClientId || !googleClientIdPattern.test(storeGoogleClientId))
        ) {
            setError('当前店铺开启 Google 快捷登录前，请填写有效的 Google OAuth Web Client ID。');
            return;
        }
        if (storeGoogleClientId && !googleClientIdPattern.test(storeGoogleClientId)) {
            setError('当前店铺的 Google OAuth Web Client ID 格式无效。');
            return;
        }
        setError('');
        setNotice('');
        try {
            await onSaveStore({
                emailPasswordEnabled: draft.emailPasswordEnabled,
                emailAutoRegistrationEnabled: draft.emailAutoRegistrationEnabled,
                emailQuickRegistrationEnabled: draft.emailQuickRegistrationEnabled,
                googleOverrideEnabled: draft.googleOverrideEnabled,
                storeGoogleEnabled: draft.storeGoogleEnabled,
                storeGoogleClientId,
            });
            setDraft(current => ({ ...current, storeGoogleClientId }));
            setNotice(
                draft.googleOverrideEnabled
                    ? '当前店铺的账号与独立 Google 配置已保存。'
                    : '当前店铺的账号设置已保存，Google 将继承全平台默认配置。',
            );
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '当前店铺账号设置保存失败，请重试。');
        }
    };

    const savePlatform = async () => {
        const googleClientId = draft.platformGoogleClientId?.trim() || null;
        if (draft.platformGoogleEnabled && (!googleClientId || !googleClientIdPattern.test(googleClientId))) {
            setError('开启全平台 Google 快捷登录前，请填写有效的 Google OAuth Web Client ID。');
            return;
        }
        if (googleClientId && !googleClientIdPattern.test(googleClientId)) {
            setError('全平台 Google OAuth Web Client ID 格式无效。');
            return;
        }
        setError('');
        setNotice('');
        try {
            await onSavePlatform({ googleEnabled: draft.platformGoogleEnabled, googleClientId });
            setDraft(current => ({ ...current, platformGoogleClientId: googleClientId }));
            setNotice('全平台 Google 默认配置已保存；未独立配置的店铺将自动继承。');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '全平台 Google 配置保存失败，请重试。');
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
                        邮箱功能按店铺设置；Google 默认由全平台统一管理，新店铺会自动继承。 Client ID
                        是公开标识，不要填写 Client Secret。
                    </p>
                </div>
            </div>

            <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
                <div>
                    <strong className="text-xs text-slate-900">全平台 Google 默认配置</strong>
                    <p className="mt-1 text-[11px] leading-4 text-slate-500">
                        Client ID 只需设置一次，当前及以后新增的店铺都会继承；新增独立域名仍需在 Google Cloud
                        添加授权来源。仅超级管理员可修改。
                    </p>
                </div>
                <div className="mt-3 rounded-lg border border-blue-100 bg-white">
                    <SwitchRow
                        label="全平台默认启用 Google 快捷注册与登录"
                        description="使用 Google Identity Services，新账号自动注册，已有同邮箱账号安全关联。"
                        checked={draft.platformGoogleEnabled}
                        disabled={!canEditPlatform || busy}
                        onChange={checked => update('platformGoogleEnabled', checked)}
                    />
                </div>
                <label
                    className="mt-3 block text-xs font-bold text-slate-700"
                    htmlFor="platform-google-client-id"
                >
                    全平台 Google OAuth Web Client ID
                </label>
                <input
                    id="platform-google-client-id"
                    value={draft.platformGoogleClientId ?? ''}
                    disabled={!canEditPlatform || busy}
                    onChange={event => update('platformGoogleClientId', event.target.value)}
                    placeholder="1234567890-xxxx.apps.googleusercontent.com"
                    className="mt-2 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
                />
                <button
                    type="button"
                    disabled={!canEditPlatform || busy}
                    onClick={() => void savePlatform()}
                    className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-xs font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {platformSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                    {platformSaving ? '保存中' : '保存全平台 Google 配置'}
                </button>
            </div>

            <div className="mt-5">
                <strong className="text-xs text-slate-900">当前店铺配置</strong>
                <p className="mt-1 text-[11px] leading-4 text-slate-500">
                    邮箱注册登录始终按当前店铺控制；Google 可继承上方全平台默认值。
                </p>
            </div>
            <div className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
                <SwitchRow
                    label="邮箱密码注册与登录"
                    description="在登录页和注册页显示邮箱入口。"
                    checked={draft.emailPasswordEnabled}
                    disabled={disabled || busy}
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
                    disabled={disabled || busy || !draft.emailPasswordEnabled}
                    onChange={checked => update('emailAutoRegistrationEnabled', checked)}
                />
                <SwitchRow
                    label="邮箱快捷注册"
                    description="注册页只填写邮箱，点击验证邮件后再设置密码。"
                    checked={draft.emailQuickRegistrationEnabled}
                    disabled={disabled || busy || !draft.emailPasswordEnabled}
                    onChange={checked => update('emailQuickRegistrationEnabled', checked)}
                />
                <SwitchRow
                    label="当前店铺使用独立 Google 配置"
                    description="默认关闭并继承全平台配置；只有独立品牌或独立 Google 项目时才开启。"
                    checked={draft.googleOverrideEnabled}
                    disabled={disabled || busy}
                    onChange={checked => update('googleOverrideEnabled', checked)}
                />
                {draft.googleOverrideEnabled ? (
                    <SwitchRow
                        label="当前店铺启用 Google 快捷注册与登录"
                        description="此开关和下方 Client ID 只影响当前店铺。"
                        checked={draft.storeGoogleEnabled}
                        disabled={disabled || busy}
                        onChange={checked => update('storeGoogleEnabled', checked)}
                    />
                ) : null}
            </div>

            {draft.googleOverrideEnabled ? (
                <>
                    <label
                        className="mt-4 block text-xs font-bold text-slate-700"
                        htmlFor="store-google-client-id"
                    >
                        当前店铺 Google OAuth Web Client ID
                    </label>
                    <input
                        id="store-google-client-id"
                        value={draft.storeGoogleClientId ?? ''}
                        disabled={disabled || busy}
                        onChange={event => update('storeGoogleClientId', event.target.value)}
                        placeholder="1234567890-xxxx.apps.googleusercontent.com"
                        className="mt-2 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
                    />
                </>
            ) : (
                <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] leading-5 text-emerald-800">
                    正在继承全平台 Google 配置：
                    <strong>{draft.platformGoogleEnabled ? '已开启' : '未开启'}</strong>
                    {draft.platformGoogleClientId
                        ? ` · ${draft.platformGoogleClientId}`
                        : ' · 尚未填写 Client ID'}
                </div>
            )}

            <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700"
            >
                前往 Google Cloud 管理 OAuth Web Client ID
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
                disabled={disabled || busy}
                onClick={() => void saveStore()}
                className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
                {storeSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                {storeSaving ? '保存中' : '保存当前店铺账号设置'}
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
