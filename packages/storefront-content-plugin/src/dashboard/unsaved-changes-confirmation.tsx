import { useBlocker } from '@vendure/dashboard';
import { useEffect } from 'react';

export function UnsavedChangesConfirmation({ when }: Readonly<{ when: boolean }>) {
    const blocker = useBlocker({
        shouldBlockFn: () => when,
        withResolver: true,
        enableBeforeUnload: () => when,
    });

    useEffect(() => {
        if (blocker.status !== 'blocked') {
            return;
        }
        if (window.confirm('当前页面有未保存的修改，确定离开吗？')) {
            blocker.proceed();
        } else {
            blocker.reset();
        }
    }, [blocker]);

    return null;
}
