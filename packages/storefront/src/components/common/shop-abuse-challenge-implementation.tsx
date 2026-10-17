import { useId } from 'react';

import { type ShopAbuseAction, type ShopAbuseClient, type ShopAbuseProof } from '../../shop-abuse';
import { shopAbuseErrorMessage } from '../../shop-abuse-copy';
import { shopAbuseFailure } from '../../shop-abuse-failure';
import { type StorefrontLanguage } from '../../types';

import {
    type ShopAbuseChallengeResult as Result,
    type ShopAbuseChallengeControlProps,
    type ShopAbuseChallengeState as State,
} from './shop-abuse-challenge-contracts';

import './shop-abuse-challenge.css';

const normalize = (value: string) => value.replace(/\s/g, '').toUpperCase();
const format = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export function createShopAbuseChallengeEngine(
    client: Partial<ShopAbuseClient>,
    language: StorefrontLanguage,
    onState: (state: State | null) => void,
) {
    let current: State | null = null;
    let generation = 0;
    let abort: AbortController | null = null;
    let active = true;
    const t = (zh: string, en: string) => (language === 'zh' ? zh : en);
    function update(value: State | null) {
        current = value;
        if (active) onState(value);
    }
    function reset() {
        generation++;
        abort?.abort();
        update(null);
    }
    function dispose() {
        active = false;
        generation++;
        abort?.abort();
    }
    async function load(action: ShopAbuseAction, target: string, error = '', retryAfterSeconds?: number) {
        abort?.abort();
        const controller = new AbortController();
        abort = controller;
        const version = ++generation;
        update({ action, target, answer: '', loading: true, error, retryAfterSeconds });
        try {
            if (!client.createShopAbuseChallenge) throw new Error('Challenge service is unavailable');
            const challenge = await client.createShopAbuseChallenge(action, target, controller.signal);
            if (
                !/^[A-Za-z0-9_-]{8,160}$/.test(challenge.id) ||
                challenge.imageDataUrl.length > 300000 ||
                !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(challenge.imageDataUrl) ||
                !Number.isFinite(Date.parse(challenge.expiresAt)) ||
                Date.parse(challenge.expiresAt) <= Date.now()
            )
                throw new Error('Invalid challenge response');
            if (active && version === generation)
                update({ action, target, answer: '', loading: false, challenge, error, retryAfterSeconds });
        } catch (cause) {
            if (controller.signal.aborted || !active || version !== generation) return;
            const failure = shopAbuseFailure(cause);
            update({
                action,
                target,
                answer: '',
                loading: false,
                feedbackOnly:
                    failure?.code === 'SHOP_ABUSE_RATE_LIMITED' || failure?.code === 'SHOP_ABUSE_UNAVAILABLE',
                error: shopAbuseErrorMessage(
                    cause,
                    language,
                    t('验证图片暂时无法加载，请重试。', 'The verification image could not load. Try again.'),
                ),
                retryAfterSeconds: failure?.retryAfterSeconds,
            });
        }
    }
    async function execute<T>(
        action: ShopAbuseAction,
        target: string,
        work: (proof?: ShopAbuseProof) => Promise<T>,
    ): Promise<Result<T>> {
        const prior = current;
        const matched = prior?.action === action && prior.target === target;
        let proof: ShopAbuseProof | undefined;
        if (matched && !prior.feedbackOnly) {
            if (prior.loading) return { executed: false };
            if (!prior.challenge) {
                update({
                    ...prior,
                    error: prior.error || t('请先加载验证图片。', 'Load a verification image first.'),
                });
                return { executed: false };
            }
            if (Date.parse(prior.challenge.expiresAt) <= Date.now()) {
                await load(
                    action,
                    target,
                    t(
                        '验证码已过期，请输入新的验证码后再次提交。',
                        'The code expired. Enter the new code and submit again.',
                    ),
                );
                return { executed: false };
            }
            if (!format.test(normalize(prior.answer))) {
                update({
                    ...prior,
                    error: t(
                        '请输入图片中的 6 位字母或数字。',
                        'Enter the 6 letters or numbers shown in the image.',
                    ),
                });
                return { executed: false };
            }
            proof = { id: prior.challenge.id, answer: normalize(prior.answer) };
        } else if (prior) reset();
        const version = generation;
        try {
            const value = await work(proof);
            if (!active || version !== generation) return { executed: true, value };
            reset();
            return { executed: true, value };
        } catch (error) {
            if (!active || version !== generation) throw error;
            if (shopAbuseFailure(error)) {
                await reject(action, target, error);
                return { executed: false };
            }
            // A proof is single-use even if the target operation returns a normal business rejection.
            if (proof) await load(action, target);
            throw error;
        }
    }
    async function reject(action: ShopAbuseAction, target: string, error: unknown) {
        const failure = shopAbuseFailure(error);
        if (!failure) throw error;
        const errorAction = failure.action ?? action;
        // Only the current requested action may bind this operation's target.
        if (errorAction !== action) {
            reset();
            throw error;
        }
        const message = shopAbuseErrorMessage(error, language);
        if (
            failure.code === 'SHOP_ABUSE_CHALLENGE_REQUIRED' ||
            failure.code === 'SHOP_ABUSE_CHALLENGE_INVALID'
        )
            await load(action, target, message, failure.retryAfterSeconds);
        else
            update({
                action,
                target,
                answer: '',
                loading: false,
                error: message,
                feedbackOnly: true,
                retryAfterSeconds: failure.retryAfterSeconds,
            });
    }
    return {
        get state() {
            return current;
        },
        execute,
        reject,
        dispose,
        reset,
        setAnswer: (answer: string) => {
            if (current) update({ ...current, answer, error: '' });
        },
        refresh: () => {
            const value = current;
            if (value) void load(value.action, value.target);
        },
    };
}

export function ShopAbuseChallengeView({
    challenge,
    language,
    onSubmit,
    google,
}: ShopAbuseChallengeControlProps) {
    const id = useId();
    const value = challenge.state;
    if (!value) return null;
    const zh = language === 'zh';
    const feedback = (
        <p id={`${id}-feedback`} role="status">
            {value.error ||
                (zh ? '完成验证后，请再次点击提交。' : 'After completing verification, select submit again.')}
            {value.retryAfterSeconds
                ? zh
                    ? ` 请等待 ${value.retryAfterSeconds} 秒后重试。`
                    : ` Try again after ${value.retryAfterSeconds} seconds.`
                : ''}
        </p>
    );
    if (value.feedbackOnly) return <div className="shop-abuse-challenge">{feedback}</div>;
    return (
        <section
            className="shop-abuse-challenge"
            aria-label={zh ? '安全验证' : 'Security check'}
            aria-busy={value.loading}
        >
            <label htmlFor={id}>{zh ? '请输入图片验证码' : 'Enter the image verification code'}</label>
            <div className="shop-abuse-challenge-row">
                {value.challenge ? (
                    <img
                        src={value.challenge.imageDataUrl}
                        alt={zh ? '安全验证码图片' : 'Security verification image'}
                        width="232"
                        height="64"
                    />
                ) : (
                    <span role="status">
                        {value.loading
                            ? zh
                                ? '正在加载…'
                                : 'Loading…'
                            : zh
                              ? '图片尚未加载'
                              : 'Image not loaded'}
                    </span>
                )}
                <button type="button" onClick={challenge.refresh} disabled={value.loading}>
                    {zh ? '换一张' : 'New image'}
                </button>
            </div>
            <div className="auth-input-shell">
                <input
                    id={id}
                    value={value.answer}
                    onChange={event => challenge.setAnswer(event.target.value)}
                    onKeyDown={event => {
                        if (event.key === 'Enter' && onSubmit) {
                            event.preventDefault();
                            onSubmit(event.currentTarget.form);
                        }
                    }}
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    minLength={6}
                    maxLength={12}
                    disabled={value.loading || !value.challenge}
                    aria-describedby={`${id}-feedback`}
                    aria-invalid={Boolean(value.error)}
                />
            </div>
            {feedback}
            {google && (
                <p className="form-help">
                    {zh
                        ? '输入验证码后，请再次点击 Google 登录。'
                        : 'After entering the code, select Google sign-in again.'}
                </p>
            )}
        </section>
    );
}
