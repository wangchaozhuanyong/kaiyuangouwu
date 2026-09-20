import { describe, expect, it } from 'vitest';

import { getPermissionDisplay } from './permission-display';

describe('permission display helpers', () => {
    it('localizes core CRUD permissions without exposing the raw permission code', () => {
        expect(getPermissionDisplay('ReadAdministrator')).toEqual({
            group: 'Administrator',
            groupLabel: '员工账号',
            label: '查看员工账号',
            description: '允许查看员工账号相关数据',
            order: 0,
        });
    });

    it('localizes plugin CRUD permissions', () => {
        expect(getPermissionDisplay('UpdateStorefrontContent')).toMatchObject({
            groupLabel: '店铺前台内容',
            label: '修改店铺前台内容',
            description: '允许修改店铺前台内容相关数据',
        });
    });

    it('localizes read-write permission definitions', () => {
        expect(getPermissionDisplay('WriteDashboardGlobalViews')).toMatchObject({
            groupLabel: '全局数据视图',
            label: '编辑全局数据视图',
        });
    });

    it('localizes named referral operations', () => {
        expect(getPermissionDisplay('AdjustReferralBalance')).toMatchObject({
            groupLabel: '推荐余额',
            label: '调整推荐余额',
            description: '允许通过审计记录手动调整客户的推荐余额',
        });
        expect(getPermissionDisplay('ManageReferralWithdrawal')).toMatchObject({
            groupLabel: '推荐返佣提现',
            label: '管理推荐返佣提现',
        });
    });

    it('uses a Chinese fallback for future plugin permissions', () => {
        expect(getPermissionDisplay('ApproveSomethingNew')).toEqual({
            group: 'Other',
            groupLabel: '其他权限',
            label: '自定义操作权限',
            description: '由服务端插件注册的自定义权限',
            order: 6,
        });
    });
});
