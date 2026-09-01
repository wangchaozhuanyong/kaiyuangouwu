import { normalizeThemePreference, resolveTheme, THEME_STORAGE_KEY } from './theme';

let preference = normalizeThemePreference(null);
try {
    preference = normalizeThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
} catch {
    // 本地存储不可用时继续跟随系统外观。
}

const theme = resolveTheme(preference, window.matchMedia('(prefers-color-scheme: dark)').matches);
const root = document.documentElement;
root.classList.toggle('dark', theme === 'dark');
root.dataset.theme = theme;
root.dataset.themePreference = preference;
root.style.colorScheme = theme;

document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#080d18' : '#f8fafc');
