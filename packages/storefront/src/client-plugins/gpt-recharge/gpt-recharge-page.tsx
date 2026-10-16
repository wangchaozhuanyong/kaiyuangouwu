import { useQuery } from '@tanstack/react-query';
import {
    ArrowRight,
    ArrowUpRight,
    BookOpen,
    Check,
    CheckCircle2,
    ChevronRight,
    CircleAlert,
    CircleHelp,
    Clock3,
    LockKeyhole,
    Search,
    ShieldCheck,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { LocalePreferencesSheet, LocalePreferencesTrigger } from '../../components/common/locale-preferences';
import { storefrontQueryPresentation } from '../../loading-state';
import { usePageReadiness } from '../../page-readiness';
import { storefrontQueryKeys } from '../../query-client';
import { SubHeader, SubpageBody } from '../../storefront-ui/page-shell';
import { type StorefrontLanguage } from '../../types';

import {
    type GptRechargeClient,
    inspectRechargeSession,
    type RechargeCode,
    type RechargePlan,
    rechargePlanLabel,
    rechargePlans,
    type RechargeTask,
} from './contracts';
import { rechargeCopy, rechargeFaq, rechargeStateCopy } from './copy';
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
export function GptRechargePage({
    client,
    language = 'zh',
    onBack,
    initialTab = 'recharge',
    marketKey,
    activeTab,
    onTabChange,
    localePreferences,
}: {
    client: GptRechargeClient;
    marketKey: string;
    activeTab?: RechargeTab;
    onTabChange?: (tab: RechargeTab) => void;
    language?: StorefrontLanguage;
    onBack: () => void;
    initialTab?: RechargeTab;
    localePreferences?: RechargeLocalePreferences;
}) {
    const t = rechargeCopy(language);
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
    const [error, setError] = useState('');
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

    async function run(kind: string, work: () => Promise<void>) {
        if (operation.current) return;
        operation.current = true;
        setBusy(kind);
        setError('');
        try {
            await work();
        } catch {
            if (mounted.current)
                setError(
                    kind === 'verify'
                        ? t(
                              '兑换码无法验证，请核对是否输入完整，或稍后重试。',
                              'Could not verify the code. Check that it is complete, or try again later.',
                          )
                        : t(
                              '暂时无法完成请求，请稍后重试查询。',
                              'Could not complete the request. Try the lookup again later.',
                          ),
                );
        } finally {
            operation.current = false;
            if (mounted.current) setBusy('');
        }
    }
    function changeCode(value: string) {
        requestVersion.current++;
        setCode(value);
        setVerified(null);
        setConfirmed(false);
        setError('');
    }
    async function verify() {
        const version = requestVersion.current;
        await run('verify', async () => {
            const result = await client.verify(code.trim());
            if (!mounted.current || version !== requestVersion.current) return;
            setVerified(result);
            setPlan(result.plan);
            if (result.status !== 'available') {
                setQueryCode(code);
                setTab('query');
                const current = await client.query(code.trim());
                if (mounted.current) setQueryResult(current);
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
                const next = await client.submit(code.trim(), session);
                if (mounted.current) {
                    setTask(next);
                    setSession('');
                    setConfirmed(false);
                }
            } catch (reason) {
                if (
                    mounted.current &&
                    (reason as { errorCode?: string })?.errorCode === 'GPT_RECHARGE_NOT_ACCEPTED'
                ) {
                    setSession('');
                    setConfirmed(false);
                    setError(
                        t(
                            '本次提交未受理。请重新获取账号资料；如仍无法提交，请稍后再试。',
                            'Your submission was not accepted. Get fresh account data and try again later if needed.',
                        ),
                    );
                    return;
                }
                if (mounted.current) {
                    setUncertain(true);
                    setSession('');
                    setError(
                        t(
                            '提交结果暂时无法确认，请用原兑换码查询，避免重复充值。',
                            'The submission result is uncertain. Look up the original code to avoid a duplicate recharge.',
                        ),
                    );
                }
            }
        });
    }
    const query = () =>
        run('query', async () => {
            const next = await client.query(queryCode.trim());
            if (mounted.current) setQueryResult(next);
        });
    const isLocked = Boolean(verified || busy || task || uncertain);
    return (
        <main className="page subpage gpt-recharge-page">
            <SubHeader
                title={t('GPT自助充值', 'GPT Recharge')}
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
                <section className="gpt-recharge-surface">
                    <nav className="gpt-recharge-tabs" aria-label={t('充值功能', 'Recharge sections')}>
                        {(['recharge', 'query', 'guide'] as const).map((key, index) => (
                            <button
                                key={key}
                                type="button"
                                aria-current={tab === key ? 'page' : undefined}
                                onClick={() => {
                                    setTab(key);
                                    setError('');
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
                    {(error ||
                        configPresentation.initialError ||
                        configPresentation.paused ||
                        (config && (!config.enabled || config.maintenance))) && (
                        <div className="gpt-recharge-notices">
                            {error && (
                                <p className="gpt-recharge-alert" role="alert">
                                    <CircleAlert size={18} />
                                    {error}
                                </p>
                            )}
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
                                        await taskQuery.refetch({ cancelRefetch: false });
                                    })
                                }
                                busy={Boolean(busy)}
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
                                        onSubmit={event => {
                                            event.preventDefault();
                                            if (code.trim() && !busy && !task && !uncertain) void verify();
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
                                                placeholder={t(
                                                    '输入购买后收到的兑换码',
                                                    'Enter your redemption code',
                                                )}
                                            />
                                            <button
                                                type="submit"
                                                className="secondary-action"
                                                disabled={!code.trim() || Boolean(busy)}
                                            >
                                                {busy === 'verify'
                                                    ? t('验证中…', 'Checking…')
                                                    : t('验证', 'Verify')}
                                            </button>
                                        </div>
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
                                        <p id="gpt-session-error" className="gpt-recharge-alert" role="alert">
                                            {sessionError}
                                        </p>
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
                                    <button
                                        className="primary-action gpt-recharge-submit"
                                        type="button"
                                        disabled={
                                            !confirmed ||
                                            !verified ||
                                            !account ||
                                            Boolean(busy) ||
                                            !config?.enabled ||
                                            config.maintenance
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
                            <Search size={26} />
                            <h2>{t('兑换码查询', 'Code lookup')}</h2>
                            <p>
                                {t(
                                    '输入原兑换码，查看套餐与充值进度。',
                                    'Enter your original code to check its plan and progress.',
                                )}
                            </p>
                            <form
                                onSubmit={event => {
                                    event.preventDefault();
                                    if (queryCode.trim()) void query();
                                }}
                            >
                                <label className="gpt-recharge-field" htmlFor="gpt-query">
                                    <span>{t('兑换码', 'Redemption code')}</span>
                                    <input
                                        id="gpt-query"
                                        value={queryCode}
                                        onChange={event => {
                                            setQueryCode(event.target.value);
                                            setQueryResult(null);
                                        }}
                                        maxLength={190}
                                        disabled={Boolean(busy)}
                                        autoComplete="off"
                                        placeholder={t('输入需要查询的兑换码', 'Enter the code to look up')}
                                    />
                                </label>
                                <button
                                    className="primary-action"
                                    disabled={!queryCode.trim() || Boolean(busy)}
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
                        <div className="gpt-recharge-guide">
                            <h2>{t('使用说明', 'How it works')}</h2>
                            <ol className="gpt-recharge-guide-steps">
                                {[
                                    [
                                        t('准备兑换码', 'Prepare your code'),
                                        t(
                                            '在充值页填写购买后收到的兑换码，点击验证。',
                                            'Enter your purchased redemption code and select Verify.',
                                        ),
                                    ],
                                    [
                                        t('登录目标账号', 'Sign in to the target account'),
                                        <>
                                            {t('打开 ', 'Open ')}
                                            <a
                                                href="https://chatgpt.com/"
                                                target="_blank"
                                                rel="noreferrer noopener"
                                            >
                                                ChatGPT <ArrowUpRight size={14} />
                                            </a>
                                            {t(
                                                '，确认当前登录的是需要充值的账号。',
                                                ' and check that you are signed in to the account you want to recharge.',
                                            )}
                                        </>,
                                    ],
                                    [
                                        t('复制完整账号资料', 'Copy the complete account data'),
                                        <>
                                            {t('在同一浏览器打开', 'In the same browser, open the ')}
                                            <a
                                                href="https://chatgpt.com/api/auth/session"
                                                target="_blank"
                                                rel="noreferrer noopener"
                                            >
                                                {t('账号资料页面', 'session page')} <ArrowUpRight size={14} />
                                            </a>
                                            {t(
                                                '，全选并复制完整 JSON。手机可长按文本后全选。',
                                                ' and copy the complete JSON. On mobile, long-press the text and select all.',
                                            )}
                                        </>,
                                    ],
                                    [
                                        t('粘贴并核对', 'Paste and check'),
                                        t(
                                            '粘贴到账号资料输入框，核对识别的账号与套餐，勾选确认。',
                                            'Paste the data, check the account and plan, then tick the confirmation box.',
                                        ),
                                    ],
                                    [
                                        t('提交充值', 'Submit recharge'),
                                        t(
                                            '点击“充值提交”，等待处理。处理中或待核对时不要重复提交。',
                                            'Select Submit recharge and wait. Do not resubmit while processing or awaiting review.',
                                        ),
                                    ],
                                    [
                                        t('查询结果', 'Check the result'),
                                        t(
                                            '用原兑换码随时查询。成功后前往 ChatGPT 确认订阅状态。',
                                            'Use the original code to check progress. After completion, confirm your subscription in ChatGPT.',
                                        ),
                                    ],
                                ].map(([title, body], index) => (
                                    <li key={index}>
                                        <span className="gpt-recharge-step">{index + 1}</span>
                                        <div>
                                            <h3>{title}</h3>
                                            <p>{body}</p>
                                        </div>
                                    </li>
                                ))}
                            </ol>
                            <p className="gpt-recharge-alert">
                                <ShieldCheck size={18} />
                                {t(
                                    '账号资料含访问凭据，请勿截图、转发或发给客服。',
                                    'Account data contains access credentials. Do not take screenshots, share it or send it to support.',
                                )}
                            </p>
                            <h2 className="gpt-recharge-faq-title">{t('常见问题', 'Common questions')}</h2>
                            {rechargeFaq(language).map(([title, body]) => (
                                <details key={title}>
                                    <summary>{title}</summary>
                                    <p>{body}</p>
                                </details>
                            ))}
                        </div>
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

function TaskResult({
    task,
    onRefresh,
    busy,
    language,
}: {
    task: RechargeTask;
    onRefresh?: () => void;
    busy?: boolean;
    language: StorefrontLanguage;
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
            {onRefresh && (
                <button className="secondary-action" type="button" onClick={onRefresh} disabled={busy}>
                    {busy ? t('更新中…', 'Updating…') : t('刷新进度', 'Refresh status')}
                </button>
            )}
        </div>
    );
}
