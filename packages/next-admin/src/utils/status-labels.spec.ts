import { describe, expect, it } from 'vitest';

import { getRoleCodeLabel, getRoleLabel, getStatusLabel, getTranslationStatusLabel } from './status-labels';

describe('status label helpers', () => {
    it.each([
        ['AUTO_TRANSLATED', '已自动翻译'],
        ['MANUAL_LOCKED', '人工翻译已锁定'],
        ['STALE', '英文待复核'],
        ['FAILED', '翻译失败'],
    ])('localizes translation status %s', (status, expected) => {
        expect(getTranslationStatusLabel(status)).toBe(expected);
    });

    it.each([
        ['ACTIVE', '已启用'],
        ['RUNNING', '处理中'],
        ['Settled', '已结算'],
        ['Delivered', '已交付'],
    ])('localizes shared status %s', (status, expected) => {
        expect(getStatusLabel(status)).toBe(expected);
    });

    it('uses a Chinese fallback instead of exposing a new backend enum', () => {
        expect(getStatusLabel('NEW_BACKEND_STATE')).toBe('未知状态');
        expect(getTranslationStatusLabel('NEW_TRANSLATION_STATE')).toBe('未知状态');
    });

    it('localizes built-in system role codes and descriptions', () => {
        expect(getRoleLabel({ code: '__super_admin_role__', description: 'SuperAdmin' })).toBe('超级管理员');
        expect(getRoleLabel({ code: '__customer_role__', description: 'Customer' })).toBe('普通客户');
        expect(getRoleLabel('__super_admin_role__')).toBe('超级管理员');
        expect(getRoleLabel('Customer')).toBe('普通客户');
        expect(getRoleLabel({ code: 'custom-role', description: '运营专员' })).toBe('运营专员');
        expect(getRoleLabel(null)).toBe('未分配角色');
    });

    it('formats system role codes with clear labels', () => {
        expect(getRoleCodeLabel('__super_admin_role__')).toBe('系统内置 · __super_admin_role__');
        expect(getRoleCodeLabel('__customer_role__')).toBe('系统内置 · __customer_role__');
        expect(getRoleCodeLabel('operator')).toBe('operator');
        expect(getRoleCodeLabel(null)).toBe('');
    });
});
