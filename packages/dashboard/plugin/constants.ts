import { RwPermissionDefinition } from '@vendure/core';
import { join } from 'node:path';

export const DEFAULT_APP_PATH = join(__dirname, 'dist');
export const loggerCtx = 'DashboardPlugin';
export const defaultLanguage = 'zh_Hans';
export const defaultLocale = 'CN';
export const defaultAvailableLanguages = ['zh_Hans', 'en'];
export const defaultAvailableLocales = ['CN', 'MY'];

export const manageDashboardGlobalViews = new RwPermissionDefinition('DashboardGlobalViews');
