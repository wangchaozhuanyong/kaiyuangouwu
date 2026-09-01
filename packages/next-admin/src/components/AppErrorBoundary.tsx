import { Component, type ErrorInfo, type ReactNode } from 'react';

import { loadLatestBuild, tryRecoverFromBuildError } from '../utils/build-recovery';

interface AppErrorBoundaryProps {
    children: ReactNode;
}

interface AppErrorBoundaryState {
    error: Error | null;
    isRecovering: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
    state: AppErrorBoundaryState = { error: null, isRecovering: false };

    static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
        return {
            error: error instanceof Error ? error : new Error('管理后台发生未知错误'),
            isRecovering: false,
        };
    }

    componentDidCatch(error: Error, _errorInfo: ErrorInfo) {
        if (tryRecoverFromBuildError(error)) {
            this.setState({ isRecovering: true });
        }
    }

    render() {
        const { error, isRecovering } = this.state;
        if (!error) return this.props.children;

        return (
            <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
                <section
                    className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"
                    role="alert"
                >
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-xl text-amber-700">
                        !
                    </div>
                    <h1 className="mt-5 text-base font-bold text-slate-900">
                        {isRecovering ? '正在加载最新版本…' : '管理后台暂时无法显示'}
                    </h1>
                    <p className="mt-2 text-xs leading-5 text-slate-600">
                        {isRecovering
                            ? '检测到后台版本已更新，正在重新加载完整资源。'
                            : '可能是后台版本已更新或浏览器保留了过期资源。请刷新后重试。'}
                    </p>
                    {!isRecovering && (
                        <button
                            type="button"
                            onClick={() => loadLatestBuild()}
                            className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
                        >
                            加载最新后台
                        </button>
                    )}
                </section>
            </main>
        );
    }
}
