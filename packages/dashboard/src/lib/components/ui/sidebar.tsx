import { Trans, useLingui } from '@lingui/react/macro';
import { SidebarRail as BaseSidebarRail, useSidebar } from '@vendure-io/ui/components/ui/sidebar';
import { PanelLeftIcon } from 'lucide-react';
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
    const { toggleSidebar } = useSidebar();

    return (
        <Button
            data-sidebar="trigger"
            data-slot="sidebar-trigger"
            variant="ghost"
            size="icon"
            className={className}
            onClick={event => {
                onClick?.(event);
                toggleSidebar();
            }}
            {...props}
        >
            <PanelLeftIcon />
            <span className="sr-only">
                <Trans>Toggle sidebar</Trans>
            </span>
        </Button>
    );
}

export function SidebarRail(props: ComponentProps<typeof BaseSidebarRail>) {
    const { t } = useLingui();
    const label = t`Toggle sidebar`;

    return <BaseSidebarRail {...props} aria-label={label} title={label} />;
}
