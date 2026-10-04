import { Component, type ReactNode } from 'react';
import { isRecoverableBuildError, loadLatestBuild } from '../utils/build-recovery';
import { AdminButton } from './AdminControls';

/** A broken page must not remove the shell, other tabs or their drafts. */
export class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
    state = { error: null as Error | null };
    static getDerivedStateFromError(error: unknown) {
        return { error: error instanceof Error ? error : new Error('页面显示失败') };
    }
    render() {
        if (!this.state.error) return this.props.children;
        const expired = isRecoverableBuildError(this.state.error);
        return (
            <section className="admin-page-error" role="alert">
                <h1 className="text-base font-semibold">
                    {expired ? '后台版本已更新' : '当前页面暂时无法显示'}
                </h1>
                <p className="mt-2 text-sm text-slate-500">
                    {expired
                        ? '需要加载新版本才能继续使用此页面。请先保存其他页面的修改。'
                        : '可以重试当前页面，或通过导航继续处理其他业务。'}
                </p>
                <AdminButton
                    type="button"
                    className="mt-4 bg-blue-600 px-4 py-2 text-white"
                    onClick={() => (expired ? loadLatestBuild() : this.setState({ error: null }))}
                >
                    {expired ? '加载新版本' : '重试当前页面'}
                </AdminButton>
            </section>
        );
    }
}
