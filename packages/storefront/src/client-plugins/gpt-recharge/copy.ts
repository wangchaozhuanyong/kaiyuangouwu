import { type StorefrontLanguage } from '../../types';

import { type RechargeStatus, type RechargeTask } from './contracts';

export function rechargeProgressCopy(task: RechargeTask, language: StorefrontLanguage): string {
    const t = rechargeCopy(language);
    if (task.status !== 'running') return rechargeStateCopy(task.status, language)[0];
    const labels: Record<string, string> = {
        started: t('已开始执行', 'Execution started'),
        processing: t('正在处理充值任务', 'Processing your recharge'),
        payment_details: t('正在填写充值资料', 'Entering recharge details'),
        paying: t('正在提交付款', 'Processing payment'),
        paid: t('付款已确认，等待订阅开通', 'Payment confirmed, awaiting activation'),
        subscription_check: t('正在确认订阅状态', 'Checking subscription status'),
    };
    return labels[task.stage ?? 'processing'] ?? labels.processing;
}

export function rechargeCopy(language: StorefrontLanguage) {
    return (zh: string, en: string) => (language === 'zh' ? zh : en);
}

export function rechargeStateCopy(status: RechargeStatus, language: StorefrontLanguage) {
    const t = rechargeCopy(language);
    const copy: Record<RechargeStatus, [string, string]> = {
        queued: [
            t('已受理，等待处理', 'Accepted, waiting to process'),
            t(
                '任务已提交，开始执行后会自动更新进度。',
                'Your task was submitted. Progress updates automatically when processing starts.',
            ),
        ],
        running: [
            t('正在为你充值', 'Recharge in progress'),
            t('请耐心等待，同一兑换码无需重复提交。', 'Please wait. Do not submit the same code again.'),
        ],
        succeeded: [
            t('充值成功', 'Recharge complete'),
            t(
                '请前往 ChatGPT 确认目标账号的订阅状态。',
                'Check the subscription status of the target account in ChatGPT.',
            ),
        ],
        failed: [
            t('本次充值未完成', 'Recharge did not complete'),
            t(
                '请保留兑换码并联系客服核对，不要重复提交或更换账号尝试。',
                'Keep your code and contact support. Do not resubmit or try another account.',
            ),
        ],
        awaiting_review: [
            t('充值结果待核对', 'Result needs review'),
            t(
                '目前无法确认最终结果。请保留兑换码，查询原任务，不要再次付款。',
                'The final result is not yet confirmed. Keep your code and check the original task. Do not pay again.',
            ),
        ],
        awaiting_credentials: [
            t('等待处理', 'Waiting to process'),
            t(
                '工作人员正在补充执行资料，无需向客服提供账号资料。',
                'The team is preparing the required execution details. Do not send your account data to support.',
            ),
        ],
        awaiting_authorization: [
            t('等待账号授权', 'Waiting for account authorization'),
            t('请打开 ID 系统的授权链接完成充值。', 'Open the ID system authorization link to continue.'),
        ],
        expired: [
            t('授权已过期', 'Authorization expired'),
            t('请在自助充值页用原兑换码重新发起授权。', 'Start authorization again with the original code.'),
        ],
    };
    return copy[status];
}

export function rechargeFaq(language: StorefrontLanguage) {
    const t = rechargeCopy(language);
    return [
        [
            t('账号资料页面只有 {}？', 'The session page only shows {}?'),
            t(
                '先在同一浏览器登录目标 ChatGPT 账号，再重新打开账号资料页面。',
                'Sign in to the target ChatGPT account in the same browser, then reopen the session page.',
            ),
        ],
        [
            t('JSON 不完整或资料过期？', 'Incomplete JSON or expired account data?'),
            t(
                '重新全选复制完整账号资料，不要手动截取某个字段。',
                'Select and copy the complete account data again. Do not copy individual fields.',
            ),
        ],
        [
            t('兑换码套餐与预期不一致？', 'The code has a different plan?'),
            t(
                '实际套餐以兑换码绑定结果为准。提交前请联系购买渠道核对。',
                'The code determines your plan. Contact the seller before submitting if it differs from your purchase.',
            ),
        ],
        [
            t('兑换码已使用，还能查询吗？', 'Can I look up a used code?'),
            t(
                '可以。在“兑换码查询”中输入原兑换码，查看对应任务。',
                'Yes. Enter the original code in Code lookup to view its task.',
            ),
        ],
        [
            t('页面关闭、断网或一直处理中？', 'Closed the page, lost connection or still waiting?'),
            t(
                '重新打开本页，用原兑换码查询。处理中或待核对不等于失败，请勿重复提交。',
                'Reopen this page and look up the original code. Processing or review does not mean failure. Do not resubmit.',
            ),
        ],
    ];
}
