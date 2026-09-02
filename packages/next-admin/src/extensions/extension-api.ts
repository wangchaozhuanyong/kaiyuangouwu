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
    /**
     * Previous Dashboard URLs which must keep resolving to this capability.
     * These aliases are rendered as redirects by the application router and
     * are deliberately kept out of navigation and command-palette results.
     */
    legacyPaths?: NextAdminLegacyPath[];
    title: string;
    component: NextAdminExtensionComponent;
    permissions?: string[];
    navItem?: NextAdminExtensionNavItem;
    commandPalette?: boolean;
    preload?: () => Promise<unknown>;
}

export type NextAdminLegacyPath =
    | `/${string}`
    | {
          path: `/${string}`;
          /** Optional tab/query-aware destination for capabilities merged into a new page. */
          target: `/${string}`;
      };

function legacyPathname(value: NextAdminLegacyPath) {
    return typeof value === 'string' ? value : value.path;
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

export interface NextAdminDashboardWidgetDefinition {
    id: string;
    title: string;
    component: ComponentType;
    description?: string;
    order?: number;
    permissions?: string[];
}

export interface NextAdminDashboardAlertDefinition {
    id: string;
    component: ComponentType;
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
    dashboardWidgets?: NextAdminDashboardWidgetDefinition[];
    alerts?: NextAdminDashboardAlertDefinition[];
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
    const existingPaths = new Set(
        existingRoutes.flatMap(route => [route.path, ...(route.legacyPaths ?? []).map(legacyPathname)]),
    );
    const ownRouteIds = new Set<string>();
    const ownPaths = new Set<string>();
    for (const route of extension.routes ?? []) {
        if (!route.path.startsWith('/')) {
            throw new Error(`Next Admin extension route must be absolute: ${route.path}`);
        }
        if (existingRouteIds.has(route.id) || ownRouteIds.has(route.id)) {
            throw new Error(`Next Admin extension route id already registered: ${route.id}`);
        }
        const routePaths = [route.path, ...(route.legacyPaths ?? []).map(legacyPathname)];
        for (const path of routePaths) {
            if (existingPaths.has(path) || ownPaths.has(path)) {
                throw new Error(`Next Admin extension route path already registered: ${path}`);
            }
            ownPaths.add(path);
        }
        ownRouteIds.add(route.id);
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
    return getNextAdminExtensionRoutes().find(
        route =>
            route.path === pathname ||
            route.legacyPaths?.some(legacyPath => legacyPathname(legacyPath) === pathname),
    );
}

export function getNextAdminExtensionLegacyRoutes() {
    return getNextAdminExtensionRoutes().flatMap(route =>
        (route.legacyPaths ?? []).map(legacyPath => ({
            id: `${route.id}:legacy:${legacyPathname(legacyPath)}`,
            path: legacyPathname(legacyPath),
            target: typeof legacyPath === 'string' ? route.path : legacyPath.target,
        })),
    );
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

export function getNextAdminDashboardWidgets() {
    return getNextAdminExtensions()
        .flatMap(extension => extension.dashboardWidgets ?? [])
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
}

export function getNextAdminDashboardAlerts() {
    return getNextAdminExtensions()
        .flatMap(extension => extension.alerts ?? [])
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
