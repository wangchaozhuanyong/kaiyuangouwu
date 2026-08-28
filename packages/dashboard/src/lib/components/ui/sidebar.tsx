import { cn } from '@/vdb/lib/utils.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { SidebarRail as BaseSidebarRail, useSidebar } from '@vendure-io/ui/components/ui/sidebar';
import { PanelLeftIcon, PanelLeftOpenIcon } from 'lucide-react';
import { ComponentProps } from 'react';
import { Button } from './button.js';

export {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupAction,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarInput,
    SidebarInset,
    SidebarMenu,
    SidebarMenuAction,
    SidebarMenuBadge,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSkeleton,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
    SidebarProvider,
    SidebarSeparator,
} from '@vendure-io/ui/components/ui/sidebar';

export { useSidebar };

export function SidebarTrigger({ className, onClick, ...props }: ComponentProps<typeof Button>) {
    const { state, isMobile, toggleSidebar } = useSidebar();
    const { t } = useLingui();
    const isCollapsed = state === 'collapsed' && !isMobile;
    const label = t`Toggle sidebar`;

    return (
        <Button
            data-sidebar="trigger"
            data-slot="sidebar-trigger"
            variant={isCollapsed ? 'default' : 'ghost'}
            size={isCollapsed ? 'sm' : 'icon'}
            className={cn(
                isCollapsed &&
                    'gap-2 px-3 shadow-md ring-2 ring-primary/30 hover:bg-primary/90 focus-visible:ring-primary/50',
                className,
            )}
            aria-label={label}
            title={label}
            onClick={event => {
                onClick?.(event);
                toggleSidebar();
            }}
            {...props}
        >
            {isCollapsed ? <PanelLeftOpenIcon aria-hidden="true" /> : <PanelLeftIcon aria-hidden="true" />}
            <span className={isCollapsed ? undefined : 'sr-only'}>
                <Trans>Toggle sidebar</Trans>
            </span>
        </Button>
    );
}

export function SidebarRail(props: ComponentProps<typeof BaseSidebarRail>) {
    const { t } = useLingui();
    const { state, isMobile } = useSidebar();
    const label = t`Toggle sidebar`;
    const isCollapsed = state === 'collapsed' && !isMobile;

    return (
        <BaseSidebarRail
            {...props}
            aria-label={label}
            title={label}
            tabIndex={isCollapsed ? 0 : (props.tabIndex ?? -1)}
            className={cn(
                isCollapsed && [
                    'inset-y-auto top-1/2 h-10 w-7 -translate-y-1/2 rounded-full border border-sidebar-border',
                    'bg-primary text-primary-foreground shadow-lg after:hidden hover:bg-primary/90',
                    'group-data-[side=left]:-right-3 group-data-[side=right]:-left-3',
                    'ltr:translate-x-0 rtl:translate-x-0',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                ],
                props.className,
            )}
        >
            {isCollapsed && <PanelLeftOpenIcon className="size-4 rtl:-scale-x-100" aria-hidden="true" />}
        </BaseSidebarRail>
    );
}
