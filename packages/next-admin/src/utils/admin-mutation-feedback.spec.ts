import { gql } from '@apollo/client';
import { describe, expect, it } from 'vitest';

import {
    extractMutationFailure,
    extractMutationFailureDetails,
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
                target: '店铺档案“美宜佳”',
                pending: '正在保存店铺档案…',
                success: '店铺档案已保存',
            }),
        ).toMatchObject({
            target: '店铺档案“美宜佳”',
            pending: '正在保存店铺档案…',
            success: '店铺档案已保存',
        });
    });

    it('infers the affected entity and safe ID from operation metadata', () => {
        expect(getMutationFeedbackCopy('NextAdminDeleteSeller', {}, { id: 'seller-1' })).toMatchObject({
            action: '删除',
            target: '商家主体（ID：seller-1）',
            failure: '管理服务没有返回可识别的失败原因',
        });
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
            '批量操作部分完成：1 项成功，1 项失败',
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

    it('preserves structured business failure details for the global feedback layer', () => {
        expect(
            extractMutationFailureDetails({
                deleteSeller: {
                    result: 'NOT_DELETED',
                    message: '商家主体仍被店铺使用',
                    errorCode: 'RESOURCE_IN_USE',
                    blockingResources: [{ name: '美宜佳店铺', code: 'my-malaysia' }],
                    resolution: ['先改绑 Channel'],
                },
            }),
        ).toEqual({
            message: '商家主体仍被店铺使用',
            errorCode: 'RESOURCE_IN_USE',
            extensions: {
                code: 'RESOURCE_IN_USE',
                blockingResources: [{ name: '美宜佳店铺', code: 'my-malaysia' }],
                resolution: ['先改绑 Channel'],
            },
        });
    });

    it('summarizes partial batch failures and keeps every failure reason', () => {
        expect(
            extractMutationFailureDetails({
                deleteAssets: [
                    { result: 'DELETED' },
                    { result: 'NOT_DELETED', message: '主图仍被商品 A 使用' },
                    { result: 'NOT_DELETED', message: '主图仍被商品 B 使用' },
                ],
            }),
        ).toEqual({
            message: '批量操作部分完成：1 项成功，2 项失败',
            errorCode: 'PARTIAL_FAILURE',
            extensions: {
                code: 'PARTIAL_FAILURE',
                details: ['主图仍被商品 A 使用', '主图仍被商品 B 使用'],
                resolution: ['根据失败明细逐项处理，并且只重试失败项'],
                retryable: false,
            },
        });
    });
});
