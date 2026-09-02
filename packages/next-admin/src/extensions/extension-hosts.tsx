import { Component, useMemo, type ReactNode } from 'react';

import { useAdminPermissions } from '../hooks/use-admin-permissions';

import {
    getNextAdminActions,
    getNextAdminDashboardAlerts,
    getNextAdminDashboardWidgets,
    getNextAdminPageBlocks,
    type NextAdminPageBlockContext,
} from './extension-api';

class ExtensionBoundary extends Component<{ children: ReactNode; extensionId: string }, { failed: boolean }> {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    render() {
        if (this.state.failed) {
            return (
                <div
                    className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800"
                    role="alert"
                >
                    扩展区块加载失败，核心页面未受影响。
                </div>
            );
        }
        return this.props.children;
    }
}

function useExtensionContext(pageId: string, entity?: Record<string, unknown> | null) {
    return useMemo<NextAdminPageBlockContext>(() => ({ pageId, entity }), [entity, pageId]);
}

export function NextAdminPageBlocks({
    pageId,
    entity,
}: {
    pageId: string;
    entity?: Record<string, unknown> | null;
}) {
    const { hasAnyPermission } = useAdminPermissions();
    const context = useExtensionContext(pageId, entity);
    const blocks = getNextAdminPageBlocks(pageId).filter(
        block =>
            hasAnyPermission(block.permissions ?? []) && (!block.shouldRender || block.shouldRender(context)),
    );

    if (blocks.length === 0) return null;
    return (
        <div className="space-y-4" data-extension-location={`${pageId}:blocks`}>
            {blocks.map(block => {
                const Block = block.component;
                return (
                    <ExtensionBoundary key={block.id} extensionId={block.id}>
                        <Block context={context} />
                    </ExtensionBoundary>
                );
            })}
        </div>
    );
}

export function NextAdminActions({
    pageId,
    entity,
}: {
    pageId: string;
    entity?: Record<string, unknown> | null;
}) {
    const { hasAnyPermission } = useAdminPermissions();
    const context = useExtensionContext(pageId, entity);
    const actions = getNextAdminActions(pageId).filter(action => hasAnyPermission(action.permissions ?? []));

    if (actions.length === 0) return null;
    return (
        <div className="contents" data-extension-location={`${pageId}:actions`}>
            {actions.map(action => {
                const Action = action.component;
                return (
                    <ExtensionBoundary key={action.id} extensionId={action.id}>
                        <Action context={context} />
                    </ExtensionBoundary>
                );
            })}
        </div>
    );
}

export function NextAdminDashboardAlerts() {
    const { hasAnyPermission } = useAdminPermissions();
    const alerts = getNextAdminDashboardAlerts().filter(alert => hasAnyPermission(alert.permissions ?? []));
    if (alerts.length === 0) return null;
    return (
        <div className="space-y-3" data-extension-location="dashboard:alerts">
            {alerts.map(alert => {
                const Alert = alert.component;
                return (
                    <ExtensionBoundary key={alert.id} extensionId={alert.id}>
                        <Alert />
                    </ExtensionBoundary>
                );
            })}
        </div>
    );
}

export function NextAdminDashboardWidgets() {
    const { hasAnyPermission } = useAdminPermissions();
    const widgets = getNextAdminDashboardWidgets().filter(widget =>
        hasAnyPermission(widget.permissions ?? []),
    );
    if (widgets.length === 0) return null;
    return (
        <div className="grid gap-4 xl:grid-cols-2" data-extension-location="dashboard:widgets">
            {widgets.map(widget => {
                const Widget = widget.component;
                return (
                    <section
                        key={widget.id}
                        className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-xs"
                    >
                        <div className="mb-4">
                            <h2 className="text-sm font-bold text-slate-900">{widget.title}</h2>
                            {widget.description && (
                                <p className="mt-1 text-xs text-slate-500">{widget.description}</p>
                            )}
                        </div>
                        <ExtensionBoundary extensionId={widget.id}>
                            <Widget />
                        </ExtensionBoundary>
                    </section>
                );
            })}
        </div>
    );
}
