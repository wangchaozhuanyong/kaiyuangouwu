import type { Meta, StoryObj } from '@storybook/react-vite';
import { Home, Package, Settings } from 'lucide-react';

import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarInset,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
    SidebarRail,
    SidebarTrigger,
} from './sidebar.js';

const navigation = [
    { label: 'Overview', icon: Home, active: true },
    { label: 'Products', icon: Package, active: false },
    { label: 'Settings', icon: Settings, active: false },
];

const meta = {
    title: 'UI/Sidebar',
    component: Sidebar,
    parameters: { layout: 'fullscreen' },
    tags: ['autodocs'],
    argTypes: {
        side: {
            control: 'inline-radio',
            options: ['left', 'right'],
            description: 'Places the sidebar at the inline start or end.',
        },
        variant: {
            control: 'select',
            options: ['sidebar', 'floating', 'inset'],
            description: 'Selects the sidebar surface treatment.',
        },
        collapsible: {
            control: 'select',
            options: ['offcanvas', 'icon', 'none'],
            description: 'Controls the available collapse behavior.',
        },
    },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ApplicationNavigation: Story = {
    render: () => (
        <SidebarProvider className="min-h-[520px]">
            <Sidebar collapsible="icon" className="absolute h-[520px]">
                <SidebarHeader className="font-semibold">Vendure</SidebarHeader>
                <SidebarContent>
                    <SidebarGroup>
                        <SidebarGroupLabel>Commerce</SidebarGroupLabel>
                        <SidebarGroupContent>
                            <SidebarMenu>
                                {navigation.map(item => (
                                    <SidebarMenuItem key={item.label}>
                                        <SidebarMenuButton isActive={item.active} tooltip={item.label}>
                                            <item.icon />
                                            <span>{item.label}</span>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                ))}
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                </SidebarContent>
                <SidebarRail />
            </Sidebar>
            <SidebarInset className="min-h-[520px] p-6">
                <header className="flex items-center gap-3">
                    <SidebarTrigger />
                    <h1 className="text-lg font-semibold">Store overview</h1>
                </header>
            </SidebarInset>
        </SidebarProvider>
    ),
};

export const CollapsedNavigation: Story = {
    render: () => (
        <SidebarProvider defaultOpen={false} className="min-h-[520px]">
            <Sidebar collapsible="icon" className="absolute h-[520px]">
                <SidebarHeader className="font-semibold">Vendure</SidebarHeader>
                <SidebarContent>
                    <SidebarGroup>
                        <SidebarGroupLabel>Commerce</SidebarGroupLabel>
                        <SidebarGroupContent>
                            <SidebarMenu>
                                {navigation.map(item => (
                                    <SidebarMenuItem key={item.label}>
                                        <SidebarMenuButton isActive={item.active} tooltip={item.label}>
                                            <item.icon />
                                            <span>{item.label}</span>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                ))}
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                </SidebarContent>
                <SidebarRail />
            </Sidebar>
            <SidebarInset className="min-h-[520px] p-6">
                <header className="flex items-center gap-3">
                    <SidebarTrigger />
                    <h1 className="text-lg font-semibold">Store overview</h1>
                </header>
            </SidebarInset>
        </SidebarProvider>
    ),
};
