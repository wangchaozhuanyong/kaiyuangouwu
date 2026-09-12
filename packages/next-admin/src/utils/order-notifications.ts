export function orderNotificationLanguage(language: string): 'zh' | 'en' {
    return /^en(?:[-_]|$)/i.test(language) ? 'en' : 'zh';
}

export const ORDER_NOTIFICATION_COPY = {
    zh: {
        message: '您有新的订单，请您查看。',
        pending: '您有未处理的订单，请您及时处理。',
        enable: '启用并试听订单语音',
        mute: '关闭订单语音',
        muted: '订单语音已关闭',
        blocked: '点击顶部声音按钮，启用订单语音提醒。',
        failed: '订单语音播放失败，请检查声音设置并点击声音按钮重试。',
        disconnected: '订单提醒连接中断，正在重试',
        recovered: '订单提醒连接已恢复',
        unauthorized: '订单提醒已停止，请重新登录并确认当前店铺的订单查看权限。',
    },
    en: {
        message: 'You have a new order. Please check it.',
        pending: 'You have pending orders. Please process them promptly.',
        enable: 'Enable and preview order announcements',
        mute: 'Mute order announcements',
        muted: 'Order announcements muted',
        blocked: 'Click the sound button above to enable order announcements.',
        failed: 'Order audio could not play. Check your sound settings and click the sound button to retry.',
        disconnected: 'Order notifications disconnected. Retrying…',
        recovered: 'Order notifications reconnected',
        unauthorized:
            'Order notifications stopped. Sign in again and check your order permissions for this store.',
    },
};
