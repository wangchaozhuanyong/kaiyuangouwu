import { useMutation } from '@apollo/client/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { channelRequestContext, getActiveChannelToken, getAdminQueryScope } from '../apollo';
import { useConfirmDialog } from '../components/confirm-dialog-context';
import { UPDATE_MY_STORE_PROFILE_MUTATION, type StoreProfileRecord } from '../graphql/management.graphql';
import { refreshAfterAdminWrite } from '../utils/admin-write-readback';
import { getChannelDisplayName } from '../utils/channel-display';
import { toUserFacingError } from '../utils/user-facing-error';
import { useAdminPermissions } from './use-admin-permissions';

/** The two public-preview entry points share one Channel-bound write lifecycle. */
export function useStorePublicPreview(
    onCompleted: (message: string) => Promise<void>,
    onError: (message: string) => void,
) {
    const requestConfirmation = useConfirmDialog();
    const { hasAnyPermission } = useAdminPermissions();
    const canUpdatePublicPreview = hasAnyPermission(['UpdateStoreProfile', 'SuperAdmin']);
    const permissionRef = useRef(canUpdatePublicPreview);
    useLayoutEffect(() => {
        permissionRef.current = canUpdatePublicPreview;
    }, [canUpdatePublicPreview]);
    const mounted = useRef(false);
    const pending = useRef(false);
    const [confirming, setConfirming] = useState(false);
    const [update, state] = useMutation(UPDATE_MY_STORE_PROFILE_MUTATION);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    const togglePublicPreview = async (profile: StoreProfileRecord) => {
        if (pending.current || state.loading || !permissionRef.current || profile.status !== 'DRAFT') return;
        const matchesActiveChannel = () => getActiveChannelToken() === profile.channel.token;
        if (!matchesActiveChannel()) {
            onError('请先将当前店铺切换到要操作预览的店铺');
            return;
        }
        if (!profile.primaryDomain && !profile.isPublished) {
            onError('请先配置并验证主域名，再开放预览');
            return;
        }
        const scope = getAdminQueryScope();
        const stillCurrent = () =>
            mounted.current &&
            permissionRef.current &&
            matchesActiveChannel() &&
            scope === getAdminQueryScope();
        pending.current = true;
        setConfirming(true);
        try {
            if (!profile.isPublished) {
                const confirmed = await requestConfirmation({
                    title: `开放 ${getChannelDisplayName(profile.channel)} 的公开预览？`,
                    description:
                        '所有访客都能浏览店铺；如启用测试支付，访客也能生成模拟订单。正式营业上线检查保持独立。',
                    confirmLabel: '开放预览',
                    tone: 'warning',
                });
                if (!confirmed) return;
            }
            // Confirmation can outlive its page while a Channel switch is already in progress.
            if (!stillCurrent()) return;
            await update({
                context: channelRequestContext(profile.channel.token),
                variables: {
                    input: { expectedUpdatedAt: profile.updatedAt, isPublished: !profile.isPublished },
                },
            });
            if (!stillCurrent()) return;
            await refreshAfterAdminWrite(
                () => onCompleted(profile.isPublished ? '公开预览已关闭' : '公开预览已开放'),
                message => {
                    if (stillCurrent()) onError(message);
                },
                stillCurrent,
            );
        } catch (error) {
            if (stillCurrent()) onError(toUserFacingError(error, '更新公开预览失败'));
        } finally {
            pending.current = false;
            if (mounted.current) setConfirming(false);
        }
    };

    return { togglePublicPreview, publicPreviewBusy: confirming || state.loading, canUpdatePublicPreview };
}
