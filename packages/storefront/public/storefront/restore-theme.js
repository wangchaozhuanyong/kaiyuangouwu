// Loaded from the same origin before the app, compatible with script-src 'self'.
(function () {
    try {
        // An embedded Admin preview owns its skin; never inherit a client cache.
        if (new URLSearchParams(location.search).get('storefrontPreviewEmbedded') === '1') return;
        var key = '__storefront_theme_v1__';
        var payload;
        for (var i = 0; i < 2 && !payload; i++) {
            try {
                var candidate = JSON.parse(window[i ? 'localStorage' : 'sessionStorage'].getItem(key));
                if (
                    candidate &&
                    candidate.version === 1 &&
                    candidate.origin === location.origin &&
                    typeof candidate.channelCode === 'string' &&
                    candidate.channelCode &&
                    typeof candidate.savedAt === 'number' &&
                    candidate.savedAt <= Date.now() &&
                    Date.now() - candidate.savedAt < 7 * 86400000 &&
                    /^(classic|modern-oriental|neo-minimalist)$/.test(candidate.presetId) &&
                    candidate.colors &&
                    typeof candidate.colors === 'object'
                )
                    payload = candidate;
            } catch (e) {}
        }
        if (!payload) return;
        var root = document.documentElement;
        var names = Object.keys(payload.colors);
        var allowed =
            /^--(?:store-(?:background|primary|highlight|foreground)|auth-store-(?:background|foreground)|brand-(?:background|primary|accent|highlight)|bg|paper|surface(?:-elevated)?|soft|text|muted|accent(?:-hover|-soft|-foreground|-ink)?|selection(?:-hover|-foreground|-soft)?|interaction-(?:hover|pressed|ink)|line(?:-strong)?|focus|success|warning|danger)$/;
        if (
            !names.length ||
            names.some(function (name) {
                return !allowed.test(name) || !/^#[0-9a-f]{6}$/i.test(payload.colors[name]);
            }) ||
            !payload.colors['--bg'] ||
            !payload.colors['--text']
        )
            return;
        names.forEach(function (name) {
            root.style.setProperty(name, payload.colors[name]);
        });
        root.setAttribute('data-storefront-preset', payload.presetId);
        root.setAttribute('data-storefront-theme-channel', payload.channelCode);
        var scheme = payload.presetId === 'neo-minimalist' ? 'dark' : 'light';
        root.style.setProperty('color-scheme', scheme);
        document.querySelector('meta[name="theme-color"]').content = payload.colors['--bg'];
        document.querySelector('meta[name="color-scheme"]').content = scheme;
        root.removeAttribute('data-storefront-theme-pending');
    } catch (e) {}
})();
