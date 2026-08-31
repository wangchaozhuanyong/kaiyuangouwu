import { Component, useMemo, type ErrorInfo, type ReactNode } from 'react';
import { useAdminPermissions } from '../hooks/use-admin-permissions';
import { getNextAdminActions, getNextAdminPageBlocks, type NextAdminPageBlockContext } from './extension-api';

class ExtensionBoundary extends Component<{ children: ReactNode; extensionId: string }, { failed: boolean }> {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error(`Next Admin extension failed: ${this.props.extensionId}`, error, errorInfo);
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
