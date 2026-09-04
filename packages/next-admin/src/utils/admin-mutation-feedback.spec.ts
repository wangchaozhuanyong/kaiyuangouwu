import { gql } from '@apollo/client';
import { describe, expect, it } from 'vitest';

import {
    extractMutationFailure,
    getMutationFeedbackCopy,
    isMutationDocument,
} from './admin-mutation-feedback';

describe('admin mutation feedback', () => {
    it.each([
        ['NextAdminUpdateStoreProfile', '保存中…', '保存成功'],
        ['NextAdminDeleteStoreDomain', '删除中…', '删除成功'],
        ['NextAdminSubmitMyStoreUsdtWallet', '提交中…', '提交成功'],
        ['NextAdminPublishStorefrontPromotionPage', '发布中…', '发布成功'],
        ['NextAdminTestTelegramConnection', '执行中…', '执行成功'],
        ['AdminUpdateReferralProgram', '保存中…', '保存成功'],
        ['AdminGrantStoreCoupon', '发放中…', '发放成功'],
        ['CancelSalesOrder', '取消中…', '取消成功'],
    ])('creates action-specific copy for %s', (operationName, pending, success) => {
        expect(getMutationFeedbackCopy(operationName)).toMatchObject({ pending, success });
    });

    it('supports operation-specific copy overrides', () => {
        expect(
            getMutationFeedbackCopy('NextAdminUpdateStoreProfile', {
                pending: '正在保存店铺档案…',
                success: '店铺档案已保存',
            }),
        ).toMatchObject({ pending: '正在保存店铺档案…', success: '店铺档案已保存' });
    });

    it('only identifies mutation documents', () => {
        expect(
            isMutationDocument(
                gql`
                    mutation SaveSettings {
                        saveSettings
                    }
                `,
                'SaveSettings',
            ),
        ).toBe(true);
        expect(
            isMutationDocument(
                gql`
                    query Settings {
                        settings
                    }
                `,
                'Settings',
            ),
        ).toBe(false);
    });

    it.each([
        [
            { updateProfile: { __typename: 'ChannelDefaultLanguageError', message: '默认语言不可用' } },
            '默认语言不可用',
        ],
        [{ deleteDomain: { result: 'NOT_DELETED', message: '主域名不能直接删除' } }, '主域名不能直接删除'],
        [{ saveSettings: { success: false, message: '配置不完整' } }, '配置不完整'],
        [
            { deleteApiKeys: [{ result: 'DELETED' }, { result: 'FAILED', message: '密钥仍在使用' }] },
            '密钥仍在使用',
        ],
        [{ togglePayment: false }, '服务端未接受此次操作'],
        [{ updateProfile: null }, '管理服务未返回操作结果'],
    ])('extracts business failures from root mutation results', (data, expected) => {
        expect(extractMutationFailure(data)).toBe(expected);
    });

    it('does not mistake successful payload data or nested validation previews for mutation failure', () => {
        expect(
            extractMutationFailure({
                previewImport: {
                    __typename: 'CatalogImportPreview',
                    success: true,
                    rows: [{ error: 'SKU 为空' }],
                },
            }),
        ).toBeNull();
    });
});
