// Loaded from the same origin before the app, compatible with script-src 'self'.
(function () {
    try {
        var preset =
            sessionStorage.getItem('__storefront_preset__') ||
            localStorage.getItem('__storefront_preset__');
        if (!preset) return;
        if (preset === 'modern-oriental' || preset === 'classic') {
            document.documentElement.setAttribute('data-storefront-preset', preset);
        }
    } catch (e) {}
})();
