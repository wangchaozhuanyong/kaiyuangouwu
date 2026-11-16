import { Check, CheckCircle2, CircleAlert, Clock3, Copy, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import { type StorefrontLanguage } from '../../types';

import { rechargePlanLabel, rechargeTaskFinished, type RechargeCode, type RechargeTask } from './contracts';
import { rechargeCopy, rechargeProgressCopy, rechargeStateCopy } from './copy';

const steps = [
    ['accepted', '任务已受理', 'Task accepted'],
    ['account', '账号验证', 'Verify account'],
    ['checkout', '打开充值页面', 'Open recharge page'],
    ['card', '填写银行卡资料', 'Enter card details'],
    ['billing', '填写账单地址', 'Enter billing address'],
    ['payment', '执行充值', 'Submit recharge'],
    ['subscription', '确认订阅', 'Confirm subscription'],
    ['complete', '充值完成', 'Recharge complete'],
] as const;
const completed = {
    accepted: ['任务已受理', 'Task accepted'],
    account: ['账号验证通过', 'Account verified'],
    checkout: ['充值页面已打开', 'Recharge page opened'],
    card: ['银行卡资料已填写', 'Card details entered'],
    billing: ['账单地址已填写', 'Billing address entered'],
    payment: ['付款已确认', 'Payment confirmed'],
    subscription: ['订阅已确认', 'Subscription confirmed'],
    complete: ['充值成功', 'Recharge complete'],
};
const active = {
    account: ['正在验证账号', 'Verifying your account'],
    checkout: ['正在打开充值页面', 'Opening recharge page'],
    card: ['正在填写银行卡资料', 'Entering card details'],
    billing: ['正在填写账单地址', 'Entering billing address'],
    payment: ['正在执行充值', 'Submitting recharge'],
    subscription: ['正在确认订阅', 'Checking subscription'],
};
const time = (value: string, language: StorefrontLanguage) =>
    new Date(value).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });

export function RechargeTaskDetails({
    task,
    language,
}: {
    task: RechargeTask;
    language: StorefrontLanguage;
}) {
    const t = rechargeCopy(language);
    const [copyState, setCopyState] = useState('');
    return (
        <section className="gpt-recharge-task-details" aria-label={t('任务资料', 'Task details')}>
            <h2>{t('任务资料', 'Task details')}</h2>
            <dl className="gpt-recharge-summary">
                <div>
                    <dt>{t('目标账号', 'Target account')}</dt>
                    <dd>{task.accountEmail || t('该任务未记录邮箱', 'Email not recorded for this task')}</dd>
                </div>
                <div>
                    <dt>{t('充值套餐', 'Plan')}</dt>
                    <dd>{rechargePlanLabel(task.plan)}</dd>
                </div>
                <div className="gpt-recharge-reference">
                    <dt>{t('查询编号', 'Reference')}</dt>
                    <dd>{task.id}</dd>
                </div>
            </dl>
            <button
                type="button"
                className="gpt-recharge-text-button"
                onClick={() => {
                    if (!navigator.clipboard?.writeText) {
                        setCopyState(t('请选中编号手动复制', 'Select the reference to copy it'));
                        return;
                    }
                    void navigator.clipboard
                        ?.writeText(task.id)
                        .then(() => setCopyState(t('编号已复制', 'Reference copied')))
                        .catch(() =>
                            setCopyState(t('请选中编号手动复制', 'Select the reference to copy it')),
                        );
                }}
            >
                <Copy size={16} aria-hidden="true" />
                {t('复制编号', 'Copy reference')}
            </button>
            {copyState && (
                <p className="gpt-recharge-helper" role="status">
                    {copyState}
                </p>
            )}
        </section>
    );
}

export function RechargeProgressPanel({
    task,
    language,
    sync,
    manual,
    onRefresh,
    onRetry,
    onContactSupport,
    code,
}: {
    task: RechargeTask | null;
    language: StorefrontLanguage;
    sync: 'connecting' | 'live' | 'error' | 'paused' | 'denied';
    manual: boolean;
    onRefresh: () => void;
    onRetry?: () => void;
    onContactSupport?: () => void;
    code?: RechargeCode | null;
}) {
    const t = rechargeCopy(language);
    const terminal = Boolean(task && rechargeTaskFinished(task.status));
    const last = task?.progress?.milestones
        .slice()
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
        .at(-1);
    const current =
        task?.status === 'running' && last && last.key !== 'accepted'
            ? last.state === 'waiting'
                ? t('已提交，等待处理结果', 'Submitted, awaiting result')
                : last.state === 'active' && last.key in active
                  ? active[last.key as keyof typeof active][language === 'zh' ? 0 : 1]
                  : completed[last.key][language === 'zh' ? 0 : 1]
            : task
              ? rechargeProgressCopy(task, language)
              : '';
    const problem = task && ['failed', 'awaiting_review', 'expired'].includes(task.status);
    const Icon = task?.status === 'succeeded' ? CheckCircle2 : problem ? CircleAlert : Clock3;
    const furthest = Math.max(
        -1,
        ...(task?.progress?.milestones ?? []).map(step => steps.findIndex(([key]) => key === step.key)),
    );
    return (
        <div className="gpt-recharge-progress" data-status={task?.status ?? 'empty'}>
            <div className="gpt-recharge-progress-toolbar">
                <h2>
                    {task || code
                        ? t('充值进度', 'Recharge progress')
                        : t('在这里查看充值进度', 'Your progress appears here')}
                </h2>
                {task && (
                    <div className="gpt-recharge-progress-tools">
                        <span className="gpt-recharge-sync" data-sync={terminal ? 'finished' : sync}>
                            {terminal
                                ? t('已结束', 'Finished')
                                : sync === 'live'
                                  ? t('已连接', 'Connected')
                                  : sync === 'paused'
                                    ? t('更新已暂停', 'Updates paused')
                                    : sync === 'denied'
                                      ? t('请重新查询', 'Look up again')
                                      : sync === 'connecting'
                                        ? t('正在连接', 'Connecting')
                                        : t('正在重连', 'Reconnecting')}
                        </span>
                        <button
                            type="button"
                            className="gpt-recharge-text-button"
                            disabled={manual || sync === 'paused' || sync === 'denied'}
                            aria-busy={manual}
                            onClick={onRefresh}
                        >
                            <RefreshCw size={16} aria-hidden="true" />
                            {manual ? t('核对中…', 'Checking…') : t('核对进度', 'Check status')}
                        </button>
                    </div>
                )}
            </div>
            {!task ? (
                <div className="gpt-recharge-progress-empty">
                    {code && (
                        <h3>
                            {code.reason === 'manual_review_required'
                                ? t('上次结果待核对', 'Previous result needs review')
                                : code.status === 'available'
                                  ? t('兑换码尚未使用', 'Code not yet used')
                                  : t('兑换码暂不可用', 'Code unavailable')}
                        </h3>
                    )}
                    <p>
                        {code
                            ? t(
                                  '没有可展示的执行记录，请保留原兑换码。',
                                  'No execution record is available. Keep your original code.',
                              )
                            : t(
                                  '提交充值或查询原兑换码后，关键步骤会在这里更新。',
                                  'Submit a recharge or look up your code to follow the key steps here.',
                              )}
                    </p>
                    {code && (
                        <p>
                            {t('绑定套餐：', 'Plan: ')}
                            {rechargePlanLabel(code.plan)}
                        </p>
                    )}
                </div>
            ) : (
                <>
                    <div className="gpt-recharge-status-heading" role="status" aria-live="polite">
                        <span className="gpt-recharge-status-icon">
                            <Icon size={22} aria-hidden="true" />
                        </span>
                        <div className="gpt-recharge-current-step">
                            <span>{t('当前状态', 'Current status')}</span>
                            <strong>{current}</strong>
                        </div>
                    </div>
                    <p className="gpt-recharge-status-description">
                        {rechargeStateCopy(task.status, language)[1]}
                    </p>
                    {task.status === 'running' && task.progress?.retryAt && (
                        <p className="gpt-recharge-helper">
                            {t(
                                '正在重新处理，以下为本次执行进度。',
                                'Processing again. The steps below reflect the current attempt.',
                            )}
                        </p>
                    )}
                    {task.progress ? (
                        <ol
                            className="gpt-recharge-timeline"
                            aria-label={t('任务关键步骤', 'Task milestones')}
                        >
                            {steps.map(([key, zh, en], index) => {
                                const fact = task.progress?.milestones.find(step => step.key === key);
                                const stopped = Boolean(
                                    fact &&
                                    fact.state !== 'complete' &&
                                    (terminal || task.status === 'awaiting_review'),
                                );
                                const state = stopped
                                    ? 'missing'
                                    : (fact?.state ?? (terminal || index < furthest ? 'missing' : 'pending'));
                                const label = stopped
                                    ? t(zh, en) +
                                      (task.status === 'awaiting_review'
                                          ? t(' · 待核对', ' · Under review')
                                          : t(' · 未记录完成', ' · Completion not recorded'))
                                    : fact?.state === 'waiting'
                                      ? t('已提交，等待处理结果', 'Submitted, awaiting result')
                                      : fact?.state === 'complete'
                                        ? completed[key][language === 'zh' ? 0 : 1]
                                        : fact?.state === 'active' && key in active
                                          ? active[key as keyof typeof active][language === 'zh' ? 0 : 1]
                                          : t(zh, en);
                                return (
                                    <li key={key} data-state={state}>
                                        <span className="gpt-recharge-timeline-marker" aria-hidden="true">
                                            {state === 'complete' ? <Check size={14} /> : <span />}
                                        </span>
                                        <span>{label}</span>
                                        <span className="gpt-recharge-timeline-time">
                                            {fact
                                                ? time(fact.at, language)
                                                : state === 'missing'
                                                  ? t('未记录', 'Not recorded')
                                                  : t('待执行', 'Pending')}
                                        </span>
                                    </li>
                                );
                            })}
                        </ol>
                    ) : (
                        <p className="gpt-recharge-helper">
                            {t(
                                '该任务未记录详细步骤，当前状态来自执行端回执。',
                                'Detailed steps were not recorded. The current status comes from the executor.',
                            )}
                        </p>
                    )}
                    <p className="gpt-recharge-progress-updated">
                        {t('最近进展：', 'Latest progress: ')}
                        {new Date(task.progress?.changedAt ?? task.updatedAt).toLocaleString(
                            language === 'zh' ? 'zh-CN' : 'en-GB',
                        )}
                    </p>
                    {!terminal && sync !== 'live' && sync !== 'connecting' && (
                        <p className="gpt-recharge-helper" role="status">
                            {sync === 'denied'
                                ? t(
                                      '请用原兑换码重新查询以恢复访问。',
                                      'Look up your original code to restore access.',
                                  )
                                : t(
                                      '已保留上次进度，连接恢复后继续更新。',
                                      'Your last progress is retained. Updates resume when connected.',
                                  )}
                        </p>
                    )}
                    {onRetry && (
                        <button type="button" className="primary-action" onClick={onRetry}>
                            {task.status === 'expired'
                                ? t('重新发起授权', 'Restart authorization')
                                : t('使用原码重新充值', 'Retry with original code')}
                        </button>
                    )}
                    {problem && onContactSupport && (
                        <button type="button" className="gpt-recharge-text-button" onClick={onContactSupport}>
                            {t('联系客服核对', 'Contact support')}
                        </button>
                    )}
                </>
            )}
        </div>
    );
}
