import { Moon, Sun } from 'lucide-react';

import { useTheme } from '../theme/theme-context';

const BASE_BUTTON_CLASS_NAME = [
    'flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors',
    'hover:bg-slate-100 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500',
].join(' ');

export function ThemeToggleButton({ className = '' }: { className?: string }) {
    const { resolvedTheme, setPreference } = useTheme();
    const isDark = resolvedTheme === 'dark';
    const label = isDark ? '切换为浅色模式' : '切换为深色模式';

    return (
        <button
            type="button"
            onClick={() => setPreference(isDark ? 'light' : 'dark')}
            className={`${BASE_BUTTON_CLASS_NAME} ${className}`}
            aria-label={label}
            title={label}
        >
            {isDark ? (
                <Sun className="h-4 w-4" aria-hidden="true" />
            ) : (
                <Moon className="h-4 w-4" aria-hidden="true" />
            )}
        </button>
    );
}
