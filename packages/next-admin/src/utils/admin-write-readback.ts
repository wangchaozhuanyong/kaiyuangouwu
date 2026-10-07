import { publishAdminFeedback } from './admin-feedback';

/** Call only after an accepted write. The callback contains reads, never business mutations. */
export async function refreshAfterAdminWrite(
    read: () => Promise<unknown>,
    onReadError?: (message: string) => void,
    shouldNotify?: () => boolean,
) {
    try {
        await read();
    } catch {
        // A read can outlive the page or Channel that accepted the write.
        if (shouldNotify && !shouldNotify()) return;
        const message = '操作已完成，但最新数据读取失败。请刷新页面，勿重复提交。';
        publishAdminFeedback({ kind: 'info', title: '操作已完成，数据更新失败', message });
        onReadError?.(message);
    }
}
