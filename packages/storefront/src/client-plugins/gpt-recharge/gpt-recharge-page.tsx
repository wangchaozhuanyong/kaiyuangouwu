import { useQuery } from '@tanstack/react-query';
import {
    ArrowRight,
    BookOpen,
    Check,
    CheckCircle2,
    ChevronRight,
    CircleAlert,
    CircleHelp,
    Clock3,
    Headphones,
    LockKeyhole,
    Search,
    ShieldCheck,
    ShoppingBag,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { LocalePreferencesSheet, LocalePreferencesTrigger } from '../../components/common/locale-preferences';
import {
    ShopAbuseChallengeControl,
    useShopAbuseChallenge,
} from '../../components/common/shop-abuse-challenge';
import { storefrontQueryPresentation } from '../../loading-state';
import { usePageReadiness } from '../../page-readiness';
import { storefrontQueryKeys } from '../../query-client';
import { shopAbuseFailure } from '../../shop-abuse-failure';
import { storefrontErrorCode, storefrontErrorMessage } from '../../storefront-errors';
import { SubHeader, SubpageBody } from '../../storefront-ui/page-shell';
import { type CollectionSummary, type StorefrontContentBlock, type StorefrontLanguage } from '../../types';

import {
    type GptRechargeClient,
    inspectRechargeSession,
    type RechargeCode,
    type RechargePlan,
    rechargePlanLabel,
    rechargePlans,
    type RechargeTask,
} from './contracts';
import { rechargeCopy, rechargeStateCopy } from './copy';
import { GptRechargeGuide } from './gpt-recharge-guide';
import { resolveGptRechargeProductsCollection } from './gpt-recharge-navigation';
import './gpt-recharge.css';

interface RechargeLocalePreferences {
    storefrontName: string;
    currencyCode: string;
    currencyCodes: string[];
    currencyLoading: boolean;
    onToggleLanguage: () => void;
    onCurrencyChange: (currencyCode: string) => void | Promise<void>;
}

type RechargeTab = 'recharge' | 'query' | 'guide';
type RechargeOperation = 'verify' | 'submit' | 'query' | 'refresh';
// Reviewed localized display copy, populated through the shared error formatter.
type RechargeFeedback = { scope: RechargeOperation; text: string; field?: 'code' | 'query' };
export function GptRechargePage({
    client,
    language = 'zh',
    onBack,
    initialTab = 'recharge',
    marketKey,
    activeTab,
    onTabChange,
    localePreferences,
    onViewProducts,
    onContactSupport,
    productCollections = [],
    productContentBlocks = [],
}: {
    client: GptRechargeClient;
    marketKey: string;
    activeTab?: RechargeTab;
    onTabChange?: (tab: RechargeTab) => void;
    language?: StorefrontLanguage;
    onBack: () => void;
    initialTab?: RechargeTab;
    localePreferences?: RechargeLocalePreferences;
    onViewProducts?: (collectionId: string) => void;
    onContactSupport?: () => void;
    productCollections?: readonly CollectionSummary[];
    productContentBlocks?: readonly StorefrontContentBlock[];
}) {
    const t = rechargeCopy(language);
    const codeChallenge = useShopAbuseChallenge(client, language);
    const queryChallenge = useShopAbuseChallenge(client, language);
    const submitChallenge = useShopAbuseChallenge(client, language);
    const productsCollection = resolveGptRechargeProductsCollection(productCollections, productContentBlocks);
    const canViewProducts = Boolean(productsCollection && onViewProducts);
    const [preferencesOpen, setPreferencesOpen] = useState(false);
    const [localTab, setLocalTab] = useState(initialTab);
    const tab = activeTab ?? localTab;
    const setTab = (next: typeof localTab) => {
        setLocalTab(next);
        onTabChange?.(next);
    };
    const [plan, setPlan] = useState<RechargePlan>('plus');
    const [code, setCode] = useState('');
    const [session, setSession] = useState('');
    const [verified, setVerified] = useState<RechargeCode | null>(null);
    const [confirmed, setConfirmed] = useState(false);
    const [task, setTask] = useState<RechargeTask | null>(null);
    const [uncertain, setUncertain] = useState(false);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState<RechargeFeedback | null>(null);
    const [feedbackAttempt, setFeedbackAttempt] = useState<RechargeOperation | null>(null);
    const [queryCode, setQueryCode] = useState('');
    const [queryResult, setQueryResult] = useState<RechargeCode | null>(null);
    const instance = useId();
    const configQuery = useQuery({
        queryKey: [
            ...storefrontQueryKeys.privateScope(marketKey, language),
            'gpt-recharge',
            'config',
        ] as const,
        queryFn: ({ signal }) => client.config(signal),
        staleTime: 30000,
        gcTime: 0,
    });
    const config = configQuery.data;
    const configPresentation = storefrontQueryPresentation(configQuery);
    usePageReadiness(configPresentation.initialLoading);
    const taskQuery = useQuery({
        queryKey: [
            ...storefrontQueryKeys.privateScope(marketKey, language),
            'gpt-recharge',
            instance,
            task?.id ?? '',
        ] as const,
        queryFn: ({ signal }) =>
            task
                ? client.task(task.id, task.credential, signal)
                : Promise.reject(new Error(t('暂无充值任务', 'No recharge task'))),
        enabled: Boolean(task),
        initialData: task ?? undefined,
        gcTime: 0,
        staleTime: 30000,
        refetchInterval: queryState =>
            !task || ['succeeded', 'failed'].includes(queryState.state.data?.status ?? '') ? false : 60000,
    });
    const currentTask = taskQuery.data ?? task;
    const mounted = useRef(true);
    const operation = useRef(false);
    const operationScope = useRef<RechargeOperation>('verify');
    const requestVersion = useRef(0);
    let account: { email: string } | null = null;
    let sessionError = '';
    if (session.trim()) {
        try {
            account = inspectRechargeSession(session, language);
        } catch (reason) {
            sessionError = (reason as Error).message;
        }
    }
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    useEffect(() => {
        if (!feedbackAttempt || busy) return;
        if (tab !== (feedbackAttempt === 'query' ? 'query' : 'recharge')) return;
        const feedback = error?.scope === feedbackAttempt ? error : null;
        const section = document.querySelector(`[data-gpt-challenge="${feedbackAttempt}"]`);
        const target = feedback
            ? document.getElementById(
                  feedback.field
                      ? feedback.field === 'code'
                          ? 'gpt-code'
                          : 'gpt-query'
                      : `gpt-${feedbackAttempt}-error`,
              )
            : section?.querySelector<HTMLElement>('input:not(:disabled), .shop-abuse-challenge-error');
        if (!target) return;
        target.focus({ preventScroll: true });
        const bounds = target.getBoundingClientRect();
        if (bounds.top < 0 || bounds.bottom > window.innerHeight)
            target.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    }, [feedbackAttempt, busy, error, tab]);

    async function run(kind: RechargeOperation, work: () => Promise<void>) {
        if (operation.current) return;
        operation.current = true;
        operationScope.current = kind;
        setBusy(kind);
        setError(null);
        setFeedbackAttempt(null);
        try {
            await work();
        } catch (reason) {
            if (mounted.current) {
                const scope = operationScope.current;
                const fallback =
                    scope === 'verify'
                        ? t(
                              '暂时无法验证兑换码，请稍后重试。',
                              'Could not verify your code. Please try again later.',
                          )
                        : t(
                              '暂时无法查询结果，请稍后重试查询。',
                              'Could not look up the result. Please try again later.',
                          );
                setError({
                    scope,
                    // The service currently uses the same input-error envelope for invalid codes
                    // and upstream failures. Do not mark the code as invalid without that evidence.
                    text:
                        storefrontErrorCode(reason) === 'USER_INPUT_ERROR'
                            ? fallback
                            : storefrontErrorMessage(reason, language, fallback),
                });
            }
        } finally {
            operation.current = false;
            if (mounted.current) {
                setBusy('');
                setFeedbackAttempt(operationScope.current);
            }
        }
    }
    function changeCode(value: string) {
        codeChallenge.reset();
        submitChallenge.reset();
        requestVersion.current++;
        setCode(value);
        setVerified(null);
        setConfirmed(false);
        setError(null);
        setFeedbackAttempt(null);
    }
    async function verify() {
        if (!code.trim()) {
            setError({
                scope: 'verify',
                field: 'code',
                text: t('请输入兑换码。', 'Enter your redemption code.'),
            });
            setFeedbackAttempt('verify');
            return;
        }
        const version = requestVersion.current;
        await run('verify', async () => {
            const checked = await codeChallenge.execute('RECHARGE_CODE', code.trim(), proof =>
                client.verify(code.trim(), ...(proof ? ([proof] as const) : [])),
            );
            if (!checked.executed) return;
            const result = checked.value;
            if (!mounted.current || version !== requestVersion.current) return;
            setVerified(result);
            setPlan(result.plan);
            if (result.status !== 'available') {
                setQueryCode(code);
                setTab('query');
                operationScope.current = 'query';
                const current = await queryChallenge.execute('RECHARGE_CODE', code.trim(), proof =>
                    client.query(code.trim(), ...(proof ? ([proof] as const) : [])),
                );
                if (mounted.current && current.executed) setQueryResult(current.value);
            }
        });
    }
    async function submit() {
        if (
            !verified ||
            verified.status !== 'available' ||
            !account ||
            !confirmed ||
            uncertain ||
            task ||
            !config?.enabled ||
            config.maintenance
        )
            return;
        await run('submit', async () => {
            try {
                const accepted = await submitChallenge.execute('RECHARGE_SUBMIT', code.trim(), proof =>
                    client.submit(code.trim(), session, ...(proof ? ([proof] as const) : [])),
                );
                if (!accepted.executed) return;
                const next = accepted.value;
                if (mounted.current) {
                    setTask(next);
                    setSession('');
                    setConfirmed(false);
                }
            } catch (reason) {
                if (shopAbuseFailure(reason)) {
                    if (mounted.current)
                        setError({ scope: 'submit', text: storefrontErrorMessage(reason, language) });
                    return;
                }
                if (
                    mounted.current &&
                    (reason as { errorCode?: string })?.errorCode === 'GPT_RECHARGE_NOT_ACCEPTED'
                ) {
                    setSession('');
                    setConfirmed(false);
                    setError({
                        scope: 'submit',
                        text: t(
                            '本次提交未受理。请重新获取账号资料；如仍无法提交，请稍后再试。',
                            'Your submission was not accepted. Get fresh account data and try again later if needed.',
                        ),
                    });
                    return;
                }
                if (mounted.current) {
                    setUncertain(true);
                    setSession('');
                    setError({
                        scope: 'submit',
                        text: t(
                            '提交结果暂时无法确认，请用原兑换码查询，避免重复充值。',
                            'The submission result is uncertain. Look up the original code to avoid a duplicate recharge.',
                        ),
                    });
                }
            }
        });
    }
    const query = () => {
        if (!queryCode.trim()) {
            setError({
                scope: 'query',
                field: 'query',
                text: t('请输入需要查询的兑换码。', 'Enter the code to look up.'),
            });
            setFeedbackAttempt('query');
            return;
        }
        return run('query', async () => {
            const next = await queryChallenge.execute('RECHARGE_CODE', queryCode.trim(), proof =>
                client.query(queryCode.trim(), ...(proof ? ([proof] as const) : [])),
            );
            if (mounted.current && next.executed) setQueryResult(next.value);
        });
    };
    const isLocked = Boolean(verified || busy || task || uncertain);
    const submitHelp =
        !config && (configPresentation.initialError || configPresentation.paused)
            ? t(
                  '暂时无法确认充值服务状态，请检查网络后重试。',
                  'Could not confirm service availability. Check your connection and try again.',
              )
            : !config
              ? t('正在确认充值服务状态，请稍候。', 'Checking service availability. Please wait.')
              : !config.enabled || config.maintenance
                ? t(
                      '充值服务暂未开放，已有任务仍可查询。',
                      'Recharge is unavailable. Existing tasks can still be looked up.',
                  )
                : !verified || verified.status !== 'available'
                  ? t('请先验证兑换码。', 'Verify your redemption code first.')
                  : !account
                    ? t('请填写有效的账号资料。', 'Enter valid account data.')
                    : !confirmed
                      ? t(
                            '请核对账号与套餐，并勾选确认。',
                            'Check the account and plan, then select the confirmation checkbox.',
                        )
                      : '';
    return (
        <main className="page subpage gpt-recharge-page">
            <SubHeader
                title={t('ChatGPT自助充值', 'ChatGPT Recharge')}
                language={language}
                onBack={onBack}
                actionVisibility="mobile"
                action={
                    localePreferences && (
                        <LocalePreferencesTrigger
                            language={language}
                            currencyCode={localePreferences.currencyCode}
                            expanded={preferencesOpen}
                            onClick={() => setPreferencesOpen(true)}
                        />
                    )
                }
            />
            <SubpageBody>
                <div className="gpt-recharge-intro">
                    <ul className="gpt-recharge-trust" aria-label={t('服务特点', 'Service features')}>
                        {[
                            { Icon: ShieldCheck, label: t('安全加密', 'Encrypted') },
                            { Icon: CheckCircle2, label: t('自动处理', 'Automated') },
                            { Icon: Clock3, label: t('进度可查', 'Track progress') },
                            { Icon: LockKeyhole, label: t('套餐锁定', 'Plan protected') },
                        ].map(({ Icon, label }) => (
                            <li key={label}>
                                <Icon size={16} aria-hidden="true" />
                                <span>{label}</span>
                            </li>
                        ))}
                    </ul>
                    <div className="gpt-recharge-quick-links">
                        <button
                            type="button"
                            className="primary-action"
                            onClick={() => productsCollection && onViewProducts?.(productsCollection.id)}
                            disabled={!canViewProducts}
                            title={
                                canViewProducts
                                    ? undefined
                                    : t(
                                          '商品分类暂不可用，请稍后重试',
                                          'Product category is temporarily unavailable',
                                      )
                            }
                        >
                            <ShoppingBag size={17} aria-hidden="true" />
                            {t('查看商品', 'View products')}
                        </button>
                        <button
                            type="button"
                            className="primary-action"
                            onClick={onContactSupport}
                            disabled={!onContactSupport}
                        >
                            <Headphones size={17} aria-hidden="true" />
                            {t('联系客服', 'Contact support')}
                        </button>
                    </div>
                </div>
                <section className="gpt-recharge-surface">
                    <nav className="gpt-recharge-tabs" aria-label={t('充值功能', 'Recharge sections')}>
                        {(['recharge', 'query', 'guide'] as const).map((key, index) => (
                            <button
                                key={key}
                                type="button"
                                aria-current={tab === key ? 'page' : undefined}
                                onClick={() => {
                                    setTab(key);
                                    setError(null);
                                    setFeedbackAttempt(null);
                                }}
                            >
                                {
                                    [
                                        t('自助充值', 'Recharge'),
                                        t('兑换码查询', 'Code lookup'),
                                        t('使用说明', 'How it works'),
                                    ][index]
                                }
                            </button>
                        ))}
                    </nav>
                    {(configPresentation.initialError ||
                        configPresentation.paused ||
                        (config && (!config.enabled || config.maintenance))) && (
                        <div className="gpt-recharge-notices">
                            {(configPresentation.initialError || configPresentation.paused) && (
                                <div className="gpt-recharge-alert" role="alert">
                                    <span>
                                        {t(
                                            '充值服务状态读取失败，请检查网络后重试。',
                                            'Could not load service status. Check your connection and try again.',
                                        )}
                                    </span>
                                    <button
                                        className="gpt-recharge-text-button"
                                        onClick={() => void configQuery.refetch({ cancelRefetch: false })}
                                    >
                                        {t('重试', 'Retry')}
                                    </button>
                                </div>
                            )}
                            {config && (!config.enabled || config.maintenance) && (
                                <p className="gpt-recharge-helper" role="status">
                                    {t(
                                        '充值服务暂未开放，已有任务仍可查询。',
                                        'Recharge is currently unavailable. You can still look up existing tasks.',
                                    )}
                                </p>
                            )}
                        </div>
                    )}
                    {tab === 'recharge' &&
                        (currentTask ? (
                            <TaskResult
                                task={currentTask}
                                language={language}
                                onRefresh={() =>
                                    void run('refresh', async () => {
                                        const refreshed = await taskQuery.refetch({ cancelRefetch: false });
                                        if (refreshed.isError) throw refreshed.error;
                                    })
                                }
                                busy={Boolean(busy)}
                                feedback={error?.scope === 'refresh' ? error.text : undefined}
                            />
                        ) : uncertain ? (
                            <div className="gpt-recharge-result">
                                <Clock3 size={36} />
                                <h2>{t('正在确认提交结果', 'Confirming your submission')}</h2>
                                <p>
                                    {t(
                                        '请查询原兑换码，我们不会自动再次提交充值。',
                                        'Look up the original code. We will not automatically resubmit.',
                                    )}
                                </p>
                                {error?.scope === 'submit' && (
                                    <RechargeError id="gpt-submit-error" message={error.text} />
                                )}
                                <button
                                    className="primary-action"
                                    onClick={() => {
                                        setQueryCode(code);
                                        setTab('query');
                                    }}
                                >
                                    {t('查询原任务', 'Look up original task')}
                                </button>
                            </div>
                        ) : (
                            <div className="gpt-recharge-layout" aria-label={t('充值表单', 'Recharge form')}>
                                <section className="gpt-recharge-code-section">
                                    <div className="gpt-recharge-section-title">
                                        <span className="gpt-recharge-step">01</span>
                                        <h2>{t('验证兑换码', 'Verify your code')}</h2>
                                    </div>
                                    <div
                                        className="gpt-recharge-plans"
                                        role="group"
                                        aria-label={t('套餐', 'Plans')}
                                    >
                                        {rechargePlans.map(item => (
                                            <button
                                                type="button"
                                                key={item.key}
                                                aria-pressed={plan === item.key}
                                                disabled={isLocked}
                                                onClick={() => setPlan(item.key)}
                                            >
                                                <strong>{item.label}</strong>
                                                {plan === item.key &&
                                                    (verified ? (
                                                        <LockKeyhole size={15} />
                                                    ) : (
                                                        <Check size={15} />
                                                    ))}
                                            </button>
                                        ))}
                                        <button type="button" className="gpt-recharge-unavailable" disabled>
                                            <strong>Pro500</strong>
                                            <small>{t('暂未开放', 'Coming soon')}</small>
                                        </button>
                                    </div>
                                    <p className="gpt-recharge-plan-note">
                                        {t('验码后自动匹配套餐', 'Your code determines the plan')}
                                    </p>
                                    <form
                                        noValidate
                                        aria-busy={busy === 'verify'}
                                        onSubmit={event => {
                                            event.preventDefault();
                                            if (!busy && !task && !uncertain) void verify();
                                        }}
                                    >
                                        <label className="gpt-recharge-label" htmlFor="gpt-code">
                                            {t('兑换码', 'Redemption code')}
                                        </label>
                                        <div className="gpt-recharge-code-row">
                                            <input
                                                id="gpt-code"
                                                value={code}
                                                onChange={event => changeCode(event.target.value)}
                                                disabled={Boolean(busy)}
                                                maxLength={190}
                                                autoComplete="off"
                                                spellCheck={false}
                                                aria-invalid={
                                                    error?.scope === 'verify' && error.field === 'code'
                                                }
                                                aria-describedby={
                                                    error?.scope === 'verify' && error.field === 'code'
                                                        ? 'gpt-code-error'
                                                        : undefined
                                                }
                                                placeholder={t(
                                                    '输入购买后收到的兑换码',
                                                    'Enter your redemption code',
                                                )}
                                            />
                                        </div>
                                        {error?.scope === 'verify' && error.field === 'code' && (
                                            <RechargeError id="gpt-code-error" message={error.text} field />
                                        )}
                                        <div data-gpt-challenge="verify">
                                            <ShopAbuseChallengeControl
                                                challenge={codeChallenge}
                                                language={language}
                                                submitLabel={t('验证兑换码', 'Verify code')}
                                            />
                                        </div>
                                        {error?.scope === 'verify' && !error.field && (
                                            <RechargeError id="gpt-verify-error" message={error.text} />
                                        )}
                                        <button
                                            type="submit"
                                            className={`${verified ? 'secondary-action' : 'primary-action'} gpt-recharge-verify`}
                                            disabled={Boolean(busy) || codeChallenge.state?.loading}
                                        >
                                            {busy === 'verify'
                                                ? t('验证中…', 'Checking…')
                                                : t('验证兑换码', 'Verify code')}
                                        </button>
                                    </form>
                                    {verified && (
                                        <p className="gpt-recharge-valid" role="status">
                                            <CheckCircle2 size={16} />
                                            {t('已锁定', 'Plan locked:')} {rechargePlanLabel(verified.plan)}
                                        </p>
                                    )}
                                </section>
                                <section className="gpt-recharge-account-section">
                                    <div className="gpt-recharge-section-title">
                                        <span className="gpt-recharge-step">02</span>
                                        <h2>{t('填写账号并提交', 'Enter account and submit')}</h2>
                                    </div>
                                    <div className="gpt-recharge-field">
                                        <div className="gpt-recharge-field-heading">
                                            <label htmlFor="gpt-session">
                                                {t('账号资料（JSON）', 'Account data (JSON)')}
                                            </label>
                                            <button
                                                className="gpt-recharge-text-button"
                                                type="button"
                                                onClick={() => setTab('guide')}
                                            >
                                                {t('如何获取？', 'How to get it?')}
                                                <CircleHelp size={15} />
                                            </button>
                                        </div>
                                        <textarea
                                            id="gpt-session"
                                            value={session}
                                            onChange={event => {
                                                setSession(event.target.value);
                                                setConfirmed(false);
                                                if (error?.scope === 'submit') setError(null);
                                                setFeedbackAttempt(null);
                                            }}
                                            disabled={Boolean(busy)}
                                            autoComplete="off"
                                            spellCheck={false}
                                            maxLength={256000}
                                            placeholder={t(
                                                '在此粘贴完整账号资料',
                                                'Paste the complete account data here',
                                            )}
                                            aria-invalid={Boolean(sessionError)}
                                            aria-describedby={
                                                sessionError ? 'gpt-session-error' : 'gpt-session-help'
                                            }
                                        />
                                    </div>
                                    {sessionError && (
                                        <RechargeError id="gpt-session-error" message={sessionError} field />
                                    )}
                                    <dl className="gpt-recharge-summary">
                                        <div>
                                            <dt>{t('目标账号', 'Account')}</dt>
                                            <dd>
                                                {account?.email ?? t('填写后显示', 'Shown after validation')}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt>{t('充值套餐', 'Plan')}</dt>
                                            <dd>
                                                {verified
                                                    ? rechargePlanLabel(verified.plan)
                                                    : t('验码后确认', 'Confirmed by code')}
                                            </dd>
                                        </div>
                                    </dl>
                                    <label className="gpt-recharge-confirm">
                                        <input
                                            type="checkbox"
                                            checked={confirmed}
                                            disabled={!verified || !account || Boolean(busy)}
                                            onChange={event => setConfirmed(event.target.checked)}
                                        />
                                        <span>
                                            {t('我已核对账号与套餐', 'I have checked the account and plan')}
                                        </span>
                                    </label>
                                    <div data-gpt-challenge="submit">
                                        <ShopAbuseChallengeControl
                                            challenge={submitChallenge}
                                            language={language}
                                            submitLabel={t('充值提交', 'Submit recharge')}
                                            onSubmit={() => void submit()}
                                        />
                                    </div>
                                    {error?.scope === 'submit' && (
                                        <RechargeError id="gpt-submit-error" message={error.text} />
                                    )}
                                    {submitHelp && (
                                        <p id="gpt-submit-help" className="gpt-recharge-helper" role="status">
                                            {submitHelp}
                                        </p>
                                    )}
                                    {!config &&
                                        (configPresentation.initialError || configPresentation.paused) && (
                                            <button
                                                type="button"
                                                className="gpt-recharge-text-button"
                                                onClick={() =>
                                                    void configQuery.refetch({ cancelRefetch: false })
                                                }
                                            >
                                                {t('重新检查服务状态', 'Check service status again')}
                                            </button>
                                        )}
                                    <button
                                        className="primary-action gpt-recharge-submit"
                                        type="button"
                                        aria-describedby={submitHelp ? 'gpt-submit-help' : undefined}
                                        disabled={
                                            !confirmed ||
                                            !verified ||
                                            !account ||
                                            Boolean(busy) ||
                                            !config?.enabled ||
                                            config.maintenance ||
                                            submitChallenge.state?.loading
                                        }
                                        onClick={() => void submit()}
                                    >
                                        {busy === 'submit'
                                            ? t('正在提交…', 'Submitting…')
                                            : t('充值提交', 'Submit recharge')}
                                        <ArrowRight size={18} />
                                    </button>
                                    <p id="gpt-session-help" className="gpt-recharge-privacy">
                                        <ShieldCheck size={16} />
                                        {t(
                                            '账号资料仅用于充值，请勿转发给他人。',
                                            'Account data is used for recharge only. Do not share it.',
                                        )}
                                    </p>
                                </section>
                            </div>
                        ))}
                    {tab === 'query' && (
                        <div className="gpt-recharge-query">
                            <h2 className="gpt-recharge-query-title">
                                <Search size={20} aria-hidden="true" />
                                {t('兑换码查询', 'Code lookup')}
                            </h2>
                            <p>
                                {t(
                                    '输入原兑换码，查看套餐与充值进度。',
                                    'Enter your original code to check its plan and progress.',
                                )}
                            </p>
                            <form
                                noValidate
                                onSubmit={event => {
                                    event.preventDefault();
                                    if (!busy) void query();
                                }}
                            >
                                <label className="gpt-recharge-field" htmlFor="gpt-query">
                                    <span>{t('兑换码', 'Redemption code')}</span>
                                    <input
                                        id="gpt-query"
                                        value={queryCode}
                                        onChange={event => {
                                            queryChallenge.reset();
                                            setQueryCode(event.target.value);
                                            setQueryResult(null);
                                            setError(null);
                                            setFeedbackAttempt(null);
                                        }}
                                        maxLength={190}
                                        disabled={Boolean(busy)}
                                        autoComplete="off"
                                        aria-invalid={error?.scope === 'query' && error.field === 'query'}
                                        aria-describedby={
                                            error?.scope === 'query' ? 'gpt-query-error' : undefined
                                        }
                                        placeholder={t('输入需要查询的兑换码', 'Enter the code to look up')}
                                    />
                                </label>
                                {error?.scope === 'query' && error.field && (
                                    <RechargeError id="gpt-query-error" message={error.text} field />
                                )}
                                <div data-gpt-challenge="query">
                                    <ShopAbuseChallengeControl
                                        challenge={queryChallenge}
                                        language={language}
                                        submitLabel={t('查询充值结果', 'Look up result')}
                                    />
                                </div>
                                {error?.scope === 'query' && !error.field && (
                                    <RechargeError id="gpt-query-error" message={error.text} />
                                )}
                                <button
                                    className="primary-action"
                                    disabled={Boolean(busy) || queryChallenge.state?.loading}
                                >
                                    {busy === 'query'
                                        ? t('正在查询…', 'Looking up…')
                                        : t('查询充值结果', 'Look up result')}
                                </button>
                            </form>
                            {queryResult && (
                                <div className="gpt-recharge-query-result" aria-live="polite">
                                    {queryResult.task ? (
                                        <TaskResult task={queryResult.task} language={language} />
                                    ) : (
                                        <>
                                            <CheckCircle2 />
                                            <h3>
                                                {queryResult.status === 'available'
                                                    ? t('兑换码尚未使用', 'Code not yet used')
                                                    : t('兑换码暂不可用', 'Code unavailable')}
                                            </h3>
                                            <p>
                                                {t('绑定套餐：', 'Plan: ')}
                                                {rechargePlanLabel(queryResult.plan)}
                                            </p>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    {tab === 'guide' && (
                        <GptRechargeGuide
                            language={language}
                            onRecharge={() => setTab('recharge')}
                            onQuery={() => setTab('query')}
                        />
                    )}
                </section>
                {tab === 'recharge' && (
                    <div className="gpt-recharge-help-links">
                        <button className="gpt-recharge-text-button" onClick={() => setTab('guide')}>
                            <BookOpen size={16} />
                            {t('查看使用说明', 'View instructions')}
                            <ChevronRight size={16} />
                        </button>
                        <button
                            className="gpt-recharge-text-button"
                            onClick={() => {
                                setQueryCode(code);
                                setTab('query');
                            }}
                        >
                            {t('已有任务？查询进度', 'Already submitted? Check status')}
                            <ChevronRight size={16} />
                        </button>
                    </div>
                )}
            </SubpageBody>
            {preferencesOpen && localePreferences && (
                <LocalePreferencesSheet
                    storefrontLabel={localePreferences.storefrontName}
                    language={language}
                    currencyCodes={
                        localePreferences.currencyCodes.length
                            ? localePreferences.currencyCodes
                            : [localePreferences.currencyCode]
                    }
                    selectedCurrencyCode={localePreferences.currencyCode}
                    currencyLoading={localePreferences.currencyLoading}
                    onToggleLanguage={localePreferences.onToggleLanguage}
                    onSelectCurrency={localePreferences.onCurrencyChange}
                    onClose={() => setPreferencesOpen(false)}
                />
            )}
        </main>
    );
}

function RechargeError({ id, message, field = false }: { id: string; message: string; field?: boolean }) {
    return (
        <p
            id={id}
            className={`gpt-recharge-alert ${field ? 'gpt-recharge-field-error' : 'gpt-recharge-action-error'}`}
            role="alert"
            tabIndex={-1}
        >
            <CircleAlert size={18} aria-hidden="true" />
            <span>{message}</span>
        </p>
    );
}

function TaskResult({
    task,
    onRefresh,
    busy,
    language,
    feedback,
}: {
    task: RechargeTask;
    onRefresh?: () => void;
    busy?: boolean;
    language: StorefrontLanguage;
    feedback?: string;
}) {
    const t = rechargeCopy(language);
    const [title, body] = rechargeStateCopy(task.status, language);
    const Icon = task.status === 'succeeded' ? CheckCircle2 : task.status === 'failed' ? CircleAlert : Clock3;
    return (
        <div className="gpt-recharge-result" data-status={task.status} aria-live="polite">
            <Icon size={36} />
            <h2>{title}</h2>
            <p>{body}</p>
            <dl className="gpt-recharge-summary">
                <div>
                    <dt>{t('充值套餐', 'Plan')}</dt>
                    <dd>{rechargePlanLabel(task.plan)}</dd>
                </div>
                <div>
                    <dt>{t('查询编号', 'Reference')}</dt>
                    <dd>{task.id}</dd>
                </div>
                <div>
                    <dt>{t('更新时间', 'Updated')}</dt>
                    <dd>{new Date(task.updatedAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-GB')}</dd>
                </div>
            </dl>
            {feedback && <RechargeError id="gpt-refresh-error" message={feedback} />}
            {onRefresh && (
                <button className="secondary-action" type="button" onClick={onRefresh} disabled={busy}>
                    {busy ? t('更新中…', 'Updating…') : t('刷新进度', 'Refresh status')}
                </button>
            )}
        </div>
    );
}
