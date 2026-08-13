import { setupI18n } from '@lingui/core';
import { describe, expect, it } from 'vitest';

import { formatJobDuration, getJobQueueDisplayInfo, getJobQueueDisplayName } from './job-queue-utils.js';

describe('job queue presentation', () => {
    const i18n = setupI18n({
        locale: 'zh_Hans',
        messages: {
            zh_Hans: {
                'jobQueue.applyCollectionFilters': '更新商品分组匹配',
                'jobQueue.applyCollectionFilters.description': '根据筛选规则重新计算商品分组内容',
                'jobQueue.cleanSessions': '清理过期登录会话',
                'jobQueue.cleanSessions.description': '移除已过期的后台用户和客户登录会话',
                'jobQueue.custom': '自定义后台任务',
                'jobQueue.custom.description': '由插件或业务扩展创建的后台任务',
                'jobQueue.plugin-sync': '同步插件数据',
                'jobQueue.sendEmail': '发送系统邮件',
                'jobQueue.sendEmail.description': '发送订单、账户等通知邮件',
                'jobQueue.updateSearchIndex': '更新商品搜索索引',
                'jobQueue.updateSearchIndex.description': '同步商品搜索与筛选数据',
            },
        },
    });

    it('gives built-in queue identifiers a business-readable Chinese name', () => {
        expect(getJobQueueDisplayName(i18n, 'apply-collection-filters')).toBe('更新商品分组匹配');
        expect(getJobQueueDisplayName(i18n, 'clean-sessions')).toBe('清理过期登录会话');
        expect(getJobQueueDisplayName(i18n, 'update-search-index')).toBe('更新商品搜索索引');
        expect(getJobQueueDisplayName(i18n, 'send-email')).toBe('发送系统邮件');
        expect(getJobQueueDisplayInfo(i18n, 'send-email').description).toBe('发送订单、账户等通知邮件');
    });

    it('uses plugin translations and a Chinese fallback for unknown queues', () => {
        expect(getJobQueueDisplayName(i18n, 'plugin-sync')).toBe('同步插件数据');
        expect(getJobQueueDisplayName(i18n, 'unregistered-plugin-task')).toBe('自定义后台任务');
    });

    it('localizes duration units', () => {
        expect(formatJobDuration(39, 'zh_Hans')).toContain('毫秒');
        expect(formatJobDuration(61_000, 'zh_Hans')).toMatch(/1\s*分钟.*1\s*秒/u);
    });
});
