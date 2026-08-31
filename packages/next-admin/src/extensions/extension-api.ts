import type { LucideIcon } from 'lucide-react';
import type { ComponentType, LazyExoticComponent } from 'react';

export type NextAdminExtensionComponent = LazyExoticComponent<ComponentType> | ComponentType;

export interface NextAdminExtensionNavItem {
    label: string;
    sectionId: string;
    icon?: LucideIcon;
    order?: number;
}

export interface NextAdminExtensionRoute {
    id: string;
    path: `/${string}`;
    title: string;
    component: NextAdminExtensionComponent;
    permissions?: string[];
    navItem?: NextAdminExtensionNavItem;
    commandPalette?: boolean;
    preload?: () => Promise<unknown>;
}

export interface NextAdminPageBlockContext {
    entity?: Record<string, unknown> | null;
    pageId: string;
}

export interface NextAdminPageBlockDefinition {
    id: string;
    pageId: string;
    component: ComponentType<{ context: NextAdminPageBlockContext }>;
    order?: number;
    permissions?: string[];
    shouldRender?: (context: NextAdminPageBlockContext) => boolean;
}

export interface NextAdminActionDefinition {
    id: string;
    pageId: string;
    label: string;
    component: ComponentType<{ context: NextAdminPageBlockContext }>;
    order?: number;
    permissions?: string[];
}

export interface NextAdminCustomFieldInputProps {
    disabled?: boolean;
    field: Record<string, unknown>;
    onChange: (value: unknown) => void;
    value: unknown;
}

export interface NextAdminExtension {
    id: string;
    routes?: NextAdminExtensionRoute[];
    pageBlocks?: NextAdminPageBlockDefinition[];
    actions?: NextAdminActionDefinition[];
    customFieldComponents?: Record<string, ComponentType<NextAdminCustomFieldInputProps>>;
}

const extensions = new Map<string, NextAdminExtension>();

function validateExtension(extension: NextAdminExtension) {
    if (!extension.id.trim()) throw new Error('Next Admin extension id cannot be empty');
    if (extensions.has(extension.id)) {
        throw new Error(`Next Admin extension id already registered: ${extension.id}`);
    }

    const existingRoutes = getNextAdminExtensionRoutes();
    const existingRouteIds = new Set(existingRoutes.map(route => route.id));
    const existingPaths = new Set(existingRoutes.map(route => route.path));
    const ownRouteIds = new Set<string>();
    const ownPaths = new Set<string>();
    for (const route of extension.routes ?? []) {
        if (!route.path.startsWith('/')) {
            throw new Error(`Next Admin extension route must be absolute: ${route.path}`);
        }
        if (existingRouteIds.has(route.id) || ownRouteIds.has(route.id)) {
            throw new Error(`Next Admin extension route id already registered: ${route.id}`);
        }
        if (existingPaths.has(route.path) || ownPaths.has(route.path)) {
            throw new Error(`Next Admin extension route path already registered: ${route.path}`);
        }
        ownRouteIds.add(route.id);
        ownPaths.add(route.path);
    }
}

export function defineNextAdminExtension(extension: NextAdminExtension) {
    validateExtension(extension);
    extensions.set(extension.id, extension);
    return extension;
}

export function getNextAdminExtensions() {
    return Array.from(extensions.values());
}

export function getNextAdminExtensionRoutes() {
    return getNextAdminExtensions().flatMap(extension => extension.routes ?? []);
}

export function getNextAdminExtensionRoute(pathname: string) {
    return getNextAdminExtensionRoutes().find(route => route.path === pathname);
}

export function getNextAdminExtensionNavItems(sectionId?: string) {
    return getNextAdminExtensionRoutes()
        .filter(route => route.navItem && (!sectionId || route.navItem.sectionId === sectionId))
        .sort((left, right) => (left.navItem?.order ?? 0) - (right.navItem?.order ?? 0));
}

export function getNextAdminPageBlocks(pageId: string) {
    return getNextAdminExtensions()
        .flatMap(extension => extension.pageBlocks ?? [])
        .filter(block => block.pageId === pageId)
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
}

export function getNextAdminActions(pageId: string) {
    return getNextAdminExtensions()
        .flatMap(extension => extension.actions ?? [])
        .filter(action => action.pageId === pageId)
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
}

export function getNextAdminCustomFieldComponent(componentId: string) {
    for (const extension of getNextAdminExtensions()) {
        const component = extension.customFieldComponents?.[componentId];
        if (component) return component;
    }
    return undefined;
}

export function preloadNextAdminExtensionRoute(pathname: string) {
    void getNextAdminExtensionRoute(pathname)
        ?.preload?.()
        .catch(() => undefined);
}

export function resetNextAdminExtensionsForTests() {
    extensions.clear();
}
