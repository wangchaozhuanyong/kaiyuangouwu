import { setupI18n } from '@lingui/core';
import { describe, expect, it } from 'vitest';

import { getScheduledTaskDisplayInfo } from './scheduled-task-utils.js';

const messages = {
    'scheduledTask.cleanSessions': '清理过期登录会话',
    'scheduledTask.cleanSessions.description': '清理数据库中过期和不活跃的登录会话',
    'scheduledTask.custom': '扩展计划任务',
    'scheduledTask.custom.description': '由插件或业务扩展注册的定时后台任务',
    'scheduledTask.plugin-sync': '同步插件数据',
    'scheduledTask.plugin-sync.description': '定时同步插件业务数据',
};

describe('scheduled task presentation', () => {
    const i18n = setupI18n({ locale: 'zh_Hans', messages: { zh_Hans: messages } });

    it('uses Chinese business copy for built-in tasks', () => {
        expect(
            getScheduledTaskDisplayInfo(i18n, {
                id: 'clean-sessions',
                description: 'Clean expired sessions',
            }),
        ).toEqual({
            name: '清理过期登录会话',
            description: '清理数据库中过期和不活跃的登录会话',
        });
    });

    it('uses extension translations when they are registered', () => {
        expect(getScheduledTaskDisplayInfo(i18n, { id: 'plugin-sync' })).toEqual({
            name: '同步插件数据',
            description: '定时同步插件业务数据',
        });
    });

    it('does not leak an unknown task English description into the Chinese UI', () => {
        expect(
            getScheduledTaskDisplayInfo(i18n, {
                id: 'unknown-plugin-task',
                description: 'Run a custom plugin task',
            }),
        ).toEqual({
            name: '扩展计划任务',
            description: '由插件或业务扩展注册的定时后台任务',
        });
    });
});
