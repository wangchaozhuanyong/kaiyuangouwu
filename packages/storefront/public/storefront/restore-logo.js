// Loaded from the same origin before the app, compatible with script-src 'self'.
(function () {
    try {
        var cached = sessionStorage.getItem('__storefront_logo_url__');
        if (!cached) return;
        var url = new URL(cached, location.origin);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
        ['icon', 'apple-touch-icon'].forEach(function (rel) {
            var icon = document.querySelector('link[rel="' + rel + '"]');
            if (icon) icon.href = url.href;
        });
    } catch (e) {}
})();
