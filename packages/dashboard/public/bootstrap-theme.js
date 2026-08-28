(() => {
    let theme = 'system';
    try {
        const settings = JSON.parse(localStorage.getItem('vendure-user-settings') || '{}');
        theme = settings.theme || theme;
    } catch {
        // Invalid or unavailable local settings fall back to the system theme.
    }
    const resolvedTheme =
        theme === 'dark' || theme === 'light'
            ? theme
            : window.matchMedia('(prefers-color-scheme: dark)').matches
              ? 'dark'
              : 'light';
    document.documentElement.classList.add(resolvedTheme);
})();
