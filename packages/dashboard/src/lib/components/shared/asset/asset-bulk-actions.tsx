import { Button } from '@/vdb/components/ui/button.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
import { getBulkActions } from '@/vdb/framework/data-table/data-table-extensions.js';
import { useFloatingBulkActions } from '@/vdb/hooks/use-floating-bulk-actions.js';
import { usePageBlock } from '@/vdb/hooks/use-page-block.js';
import { usePage } from '@/vdb/hooks/use-page.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { ChevronDown, X } from 'lucide-react';
import { Asset } from './asset-gallery.js';

export type AssetBulkActionContext = {
    selection: Asset[];
    refetch: () => void;
};

export type AssetBulkActionComponent = React.FunctionComponent<AssetBulkActionContext>;

export type AssetBulkAction = {
    order?: number;
    placement?: 'primary' | 'menu';
    component: AssetBulkActionComponent;
};

interface AssetBulkActionsProps {
    selection: Asset[];
    bulkActions?: AssetBulkAction[];
    refetch: () => void;
    onClearSelection: () => void;
}

export function AssetBulkActions({
    selection,
    bulkActions,
    refetch,
    onClearSelection,
}: Readonly<AssetBulkActionsProps>) {
    const { t } = useLingui();
    const { pageId } = usePage();
    const pageBlock = usePageBlock();
    const blockId = pageBlock?.blockId;

    const { position, shouldShow } = useFloatingBulkActions({
        selectionCount: selection.length,
        containerSelector: '[data-asset-gallery]',
    });

    if (!shouldShow) {
        return null;
    }

    // Get extended bulk actions from the registry
    const extendedBulkActions = pageId ? getBulkActions(pageId, blockId) : [];

    // Convert DataTable bulk actions to Asset bulk actions
    const convertedBulkActions: AssetBulkAction[] = extendedBulkActions.map(action => ({
        order: action.order,
        component: ({ selection }) => {
            // Create a mock table context for compatibility
            const mockTable = {
                getState: () => ({ rowSelection: {} }),
                getRow: () => null,
            } as any;

            const ActionComponent = action.component;
            return <ActionComponent selection={selection} table={mockTable} />;
        },
    }));

    const allBulkActions = [...convertedBulkActions, ...(bulkActions ?? [])];
    allBulkActions.sort((a, b) => (a.order ?? 10_000) - (b.order ?? 10_000));
    const primaryActions = allBulkActions.filter(action => action.placement === 'primary');
    const menuActions = allBulkActions.filter(action => action.placement !== 'primary');

    return (
        <div
            className="fixed z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 animate-in items-center gap-2 rounded-lg border bg-background p-2 shadow-2xl fade-in duration-200"
            style={{
                height: 'auto',
                bottom: position.bottom,
                left: position.left,
            }}
            role="toolbar"
            aria-label={t`Asset selection actions`}
        >
            <div className="flex h-8 items-center gap-2 border-r pr-2">
                <span className="inline-flex min-w-6 items-center justify-center rounded bg-primary px-1.5 py-0.5 text-xs font-semibold tabular-nums text-primary-foreground">
                    {selection.length}
                </span>
                <span className="whitespace-nowrap text-sm font-medium">
                    <Trans>Selected</Trans>
                </span>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-muted-foreground shadow-none hover:text-foreground"
                    onClick={onClearSelection}
                    aria-label={t`Clear selection`}
                >
                    <X className="h-4 w-4" />
                    <span className="hidden sm:inline">
                        <Trans>Clear selection</Trans>
                    </span>
                </Button>
            </div>

            {primaryActions.map((action, index) => (
                <action.component
                    key={`asset-primary-bulk-action-${index}`}
                    selection={selection}
                    refetch={refetch}
                />
            ))}

            {menuActions.length > 0 && (
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={<Button variant="outline" size="sm" className="h-8 shadow-none" />}
                    >
                        <Trans>More actions</Trans>
                        <ChevronDown className="ml-1 h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {menuActions.map((action, index) => (
                            <action.component
                                key={`asset-menu-bulk-action-${index}`}
                                selection={selection}
                                refetch={refetch}
                            />
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}

            {allBulkActions.length === 0 && (
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={<Button variant="outline" size="sm" className="h-8 shadow-none" />}
                    >
                        <Trans>More actions</Trans>
                        <ChevronDown className="ml-1 h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem className="text-muted-foreground" disabled>
                            <Trans>No actions available</Trans>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </div>
    );
}
