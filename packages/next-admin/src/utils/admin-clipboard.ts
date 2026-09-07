import { runAdminActionWithFeedback } from './admin-action-feedback';

const clipboardResolution = ['检查浏览器的剪贴板权限后重试', '或手动选中页面内容进行复制'];

export async function copyAdminText(text: string, target = '内容') {
    try {
        await runAdminActionWithFeedback(
            {
                action: '复制',
                target,
                failure: '浏览器未允许写入剪贴板',
                resolution: clipboardResolution,
                preferFailureReason: true,
                skipPending: true,
                skipSuccess: true,
            },
            async () => {
                if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
                    throw new Error('当前浏览器不支持剪贴板写入');
                }
                await navigator.clipboard.writeText(text);
            },
        );
        return true;
    } catch {
        return false;
    }
}

export async function readAdminText(target = '内容') {
    try {
        return await runAdminActionWithFeedback(
            {
                action: '读取',
                target,
                failure: '浏览器未允许读取剪贴板',
                resolution: ['检查浏览器的剪贴板权限后重试', '或手动粘贴内容到输入框'],
                preferFailureReason: true,
                skipPending: true,
                skipSuccess: true,
            },
            async () => {
                if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
                    throw new Error('当前浏览器不支持剪贴板读取');
                }
                return navigator.clipboard.readText();
            },
        );
    } catch {
        return null;
    }
}
