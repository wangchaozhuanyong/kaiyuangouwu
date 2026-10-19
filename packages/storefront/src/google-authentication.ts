import type { useShopAbuseChallenge } from './components/common/shop-abuse-challenge';
import type { StorefrontLanguage } from './types';

import { ShopApi, ShopApiError } from './api';
import {
    attributionWithinWindow,
    captureReferralAttribution,
    type ReferralSource,
} from './referral-attribution';
import { isReferralClientFeatureEnabled } from './referral-client-feature';

function googleAuthErrorMessage(error: unknown, language: StorefrontLanguage): string {
    if (error instanceof ShopApiError && error.authenticationError === 'STOREFRONT_GOOGLE_AUTH_UNAVAILABLE') {
        return language === 'zh' ? 'Google 登录尚未配置' : 'Google sign-in is not configured';
    }
    if (error instanceof ShopApiError) {
        if (error.authenticationError === 'STOREFRONT_GOOGLE_CONSENT_REQUIRED')
            return language === 'zh'
                ? '首次使用 Google 注册，请先勾选同意条款与隐私政策'
                : 'To create your account with Google, accept the terms and privacy policy first';
        if (error.authenticationError === 'STOREFRONT_GOOGLE_EMAIL_VERIFICATION_REQUIRED')
            return language === 'zh'
                ? '请使用 Gmail 或 Google Workspace 账号，其他邮箱请使用邮箱注册或登录'
                : 'Use a Gmail or Google Workspace account, or register or sign in with your email';
        if (error.authenticationError === 'STOREFRONT_GOOGLE_INVITE_INVALID')
            return language === 'zh'
                ? '邀请码无效，请修改或清空后重试'
                : 'The invitation code is invalid. Change or remove it and try again';
    }
    return language === 'zh' ? 'Google 登录失败，请重试' : 'Google sign-in failed. Try again';
}

/** Google sign-in and registration share the same request owner and completion path. */
export async function authenticateGoogle({
    api,
    credential,
    language,
    requestScope,
    challenge,
    onSuccess,
    accepted,
    setSubmitting,
    setError,
    options,
    referral,
    requireConsent,
}: {
    api: ShopApi;
    credential: string;
    language: StorefrontLanguage;
    requestScope: { begin(): { signal: AbortSignal; isCurrent: () => boolean; finish: () => void } | null };
    challenge: ReturnType<typeof useShopAbuseChallenge>;
    onSuccess?: (isCurrent?: () => boolean) => Promise<void>;
    accepted: boolean;
    setSubmitting: (value: boolean) => void;
    setError: (value: string) => void;
    options?: { rememberMe?: boolean };
    referral?: { inviteCode?: string; referralSource?: ReferralSource };
    requireConsent?: boolean;
}) {
    const isZh = language === 'zh';
    if (requireConsent && !accepted)
        throw new Error(
            isZh ? '请先同意使用条款并确认隐私政策' : 'Accept the terms and privacy policy first',
        );
    const operation = requestScope.begin();
    if (!operation) return;
    let authenticated = false;
    setSubmitting(true);
    setError('');
    try {
        const captured = referral ? null : captureReferralAttribution();
        const program = captured ? await api.referralProgram(operation.signal) : null;
        if (!operation.isCurrent()) return;
        const attribution =
            program && isReferralClientFeatureEnabled(program)
                ? attributionWithinWindow(captured, program.attributionWindowDays)
                : null;
        const result = await challenge.execute('LOGIN', 'oauth:google', proof =>
            api.authenticateWithGoogle(
                credential,
                { termsAccepted: accepted, privacyAcknowledged: accepted, locale: language },
                {
                    ...options,
                    ...(referral ?? { inviteCode: attribution?.code, referralSource: attribution?.source }),
                    ...(proof ? { proof } : {}),
                },
            ),
        );
        if (!result.executed || !operation.isCurrent()) return;
        authenticated = true;
        await onSuccess?.(operation.isCurrent);
    } catch (error) {
        if (operation.isCurrent())
            throw new Error(
                authenticated
                    ? isZh
                        ? 'Google 授权已完成，但登录状态读取失败，请稍后重试'
                        : 'Google authorization completed, but the session could not load. Try again shortly.'
                    : googleAuthErrorMessage(error, language),
            );
    } finally {
        operation.finish();
        if (operation.isCurrent()) setSubmitting(false);
    }
}
