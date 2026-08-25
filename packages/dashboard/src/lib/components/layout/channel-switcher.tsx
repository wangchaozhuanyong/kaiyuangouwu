import { ChannelCodeLabel, useChannelDisplayName } from '@/vdb/components/shared/channel-code-label.js';
import { PermissionGuard } from '@/vdb/components/shared/permission-guard.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
import { ScrollArea } from '@/vdb/components/ui/scroll-area.js';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/vdb/components/ui/sidebar.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { useServerConfig } from '@/vdb/hooks/use-server-config.js';
import { useSortedLanguages } from '@/vdb/hooks/use-sorted-languages.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { Check, ChevronsUpDown, Languages, Plus, Store } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ManageLanguagesDialog } from './manage-languages-dialog.js';

/**
 * Convert the channel code to initials.
 * Splits by punctuation like '-' and '_' and takes the first letter of each part
 * up to 3 parts.
 *
 * If no splits, takes the first 3 letters.
 */
function getChannelInitialsFromCode(code: string) {
    const parts = code.split(/[-_]/);
    if (parts.length > 1) {
        return parts
            .filter(part => part.length > 0)
            .slice(0, 3)
            .map(part => part[0])
            .join('');
    } else {
        return code.slice(0, 3);
    }
}

export function ChannelSwitcher() {
    const { t } = useLingui();
    const { isMobile } = useSidebar();
    const { channels, activeChannel, setActiveChannel } = useChannel();
    const serverConfig = useServerConfig();
    const { formatLanguageName } = useLocalFormat();
    const {
        settings: { contentLanguage },
        setContentLanguage,
    } = useUserSettings();
    const [showManageLanguagesDialog, setShowManageLanguagesDialog] = useState(false);
    const displayChannel = activeChannel;
    const displayChannelName = useChannelDisplayName(displayChannel?.code);

    // Get available languages from server config
    const availableLanguages = serverConfig?.availableLanguages || [];
    const hasMultipleLanguages = availableLanguages.length > 1;

    // Currently selected channel is displayed separately so filter it out of the list
    const orderedChannels = displayChannel ? channels.filter(ch => ch.id !== displayChannel.id) : channels;

    // Sort language codes by their formatted names and map to code and label
    const sortedLanguages = useSortedLanguages(displayChannel?.availableLanguageCodes);

    useEffect(() => {
        if (activeChannel?.availableLanguageCodes) {
            // Ensure the current content language is a valid one for the active
            // channel
            if (!activeChannel.availableLanguageCodes.includes(contentLanguage as any)) {
                setContentLanguage(activeChannel.defaultLanguageCode);
            }
        }
    }, [activeChannel, contentLanguage]);

    const renderChannel = (channel: (typeof channels)[number]) => {
        const isActive = channel.id === displayChannel?.id;
        return (
            <div key={channel.code}>
                <DropdownMenuItem
                    onClick={() => setActiveChannel(channel.id)}
                    className={cn('gap-2 p-2', isActive && 'bg-accent')}
                >
                    <div
                        className={cn(
                            'flex size-8 items-center justify-center rounded border',
                            isActive
                                ? 'border-primary/30 bg-primary text-primary-foreground'
                                : 'bg-background',
                        )}
                    >
                        <span className="truncate font-semibold text-xs uppercase">
                            {getChannelInitialsFromCode(channel.code)}
                        </span>
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                            <ChannelCodeLabel code={channel.code} />
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                            {channel.defaultCurrencyCode} · {formatLanguageName(channel.defaultLanguageCode)}
                        </div>
                    </div>
                    {isActive && (
                        <span className="ms-auto inline-flex items-center gap-1 text-xs font-medium text-link">
                            <Check className="size-3.5" />
                            <Trans context="current channel">Current store</Trans>
                        </span>
                    )}
                </DropdownMenuItem>
            </div>
        );
    };

    return (
        <>
            <SidebarMenu>
                <SidebarMenuItem>
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            render={
                                <SidebarMenuButton
                                    size="lg"
                                    tooltip={t`Current store: ${displayChannelName}`}
                                    className="border border-sidebar-border/70 bg-sidebar-accent/40 data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
                                />
                            }
                        >
                            <div
                                className={
                                    'bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg'
                                }
                            >
                                <Store className="size-4" aria-hidden="true" />
                            </div>
                            <div className="grid flex-1 text-left text-sm leading-tight">
                                <span className="truncate text-[11px] text-muted-foreground">
                                    <Trans>Current store</Trans>
                                </span>
                                <span className="truncate font-semibold leading-5">
                                    <ChannelCodeLabel code={displayChannel?.code} />
                                </span>
                            </div>
                            <ChevronsUpDown className="ml-auto" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            className="w-(--anchor-width) min-w-72 rounded-lg pt-0 pr-0"
                            align="start"
                            side={isMobile ? 'bottom' : 'right'}
                            sideOffset={4}
                        >
                            <ScrollArea className="max-h-[calc(100vh_-_24px)] overflow-y-auto pr-1">
                                <div className="sticky top-0 pt-1 bg-popover z-10">
                                    <DropdownMenuGroup>
                                        <DropdownMenuLabel className="text-muted-foreground text-xs">
                                            <Trans>Switch store</Trans>
                                        </DropdownMenuLabel>
                                    </DropdownMenuGroup>
                                    {!!displayChannel && (
                                        <>
                                            {renderChannel(displayChannel)}
                                            {/* Show language sub-menu for the current channel */}
                                            <DropdownMenuSub>
                                                <DropdownMenuSubTrigger className="gap-2 p-2 ps-4">
                                                    <Languages className="w-4 h-4 shrink-0" />
                                                    <div className="flex gap-1 ms-2">
                                                        <span className="text-muted-foreground shrink-0">
                                                            <Trans>Content language:</Trans>
                                                        </span>
                                                        <span className="truncate">
                                                            {formatLanguageName(contentLanguage)}
                                                        </span>
                                                    </div>
                                                </DropdownMenuSubTrigger>
                                                <DropdownMenuSubContent>
                                                    {sortedLanguages?.map(({ code: languageCode, label }) => (
                                                        <DropdownMenuItem
                                                            key={`${displayChannel.code}-${languageCode}`}
                                                            onClick={() => setContentLanguage(languageCode)}
                                                            className={`gap-2 p-2 ${contentLanguage === languageCode ? 'bg-accent' : ''}`}
                                                        >
                                                            <div className="flex w-fit min-w-9 px-1.5 h-5 items-center justify-center rounded border shrink-0">
                                                                <span className="font-medium text-xs">
                                                                    {languageCode.toUpperCase()}
                                                                </span>
                                                            </div>
                                                            <span className="truncate flex-1">{label}</span>
                                                            {contentLanguage === languageCode && (
                                                                <span className="ms-auto text-xs text-muted-foreground shrink-0">
                                                                    <Trans context="active language">
                                                                        Active
                                                                    </Trans>
                                                                </span>
                                                            )}
                                                        </DropdownMenuItem>
                                                    ))}
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem
                                                        onClick={() => setShowManageLanguagesDialog(true)}
                                                        className="gap-2 p-2"
                                                    >
                                                        <Languages className="w-4 h-4" />
                                                        <span>
                                                            <Trans>Manage Languages</Trans>
                                                        </span>
                                                    </DropdownMenuItem>
                                                </DropdownMenuSubContent>
                                            </DropdownMenuSub>
                                            {/* Add separator after the current channel group */}
                                            {orderedChannels.length > 0 && <DropdownMenuSeparator />}
                                        </>
                                    )}
                                </div>
                                {orderedChannels.map(renderChannel)}
                                <PermissionGuard requires={['CreateChannel']}>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        className="gap-2 p-2 cursor-pointer"
                                        render={<Link to={'/channels/new'} />}
                                    >
                                        <div className="bg-background flex size-6 items-center justify-center rounded-md border">
                                            <Plus className="size-4" />
                                        </div>
                                        <div className="text-muted-foreground font-medium">
                                            <Trans>Add store</Trans>
                                        </div>
                                    </DropdownMenuItem>
                                </PermissionGuard>
                            </ScrollArea>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </SidebarMenuItem>
            </SidebarMenu>
            <ManageLanguagesDialog
                open={showManageLanguagesDialog}
                onClose={() => setShowManageLanguagesDialog(false)}
            />
        </>
    );
}
