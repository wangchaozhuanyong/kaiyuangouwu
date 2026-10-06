// Loaded from the same origin before the app, compatible with script-src 'self'.
(function () {
    try {
        // An embedded Admin preview owns its skin; never inherit a client cache.
        if (new URLSearchParams(location.search).get('storefrontPreviewEmbedded') === '1') return;
        // Cache only plain semantic colors. Derived module treatments stay in skin CSS.
        var allowed =
            /^--(?:store-(?:background|primary|highlight|foreground)|auth-store-(?:background|foreground)|brand-(?:background|primary|accent|highlight)|bg|paper|surface(?:-elevated)?|soft|text|muted|accent(?:-hover|-pressed|-soft|-foreground|-ink)?|selection(?:-hover|-foreground|-soft)?|interaction-(?:hover|pressed|ink)|line(?:-strong)?|focus|success|warning|danger)$/;
        function readCache(key, version) {
            for (var i = 0; i < 2; i++) {
                try {
                    var candidate = JSON.parse(window[i ? 'localStorage' : 'sessionStorage'].getItem(key));
                    if (
                        !candidate ||
                        candidate.version !== version ||
                        candidate.origin !== location.origin ||
                        typeof candidate.channelCode !== 'string' ||
                        !candidate.channelCode ||
                        typeof candidate.savedAt !== 'number' ||
                        candidate.savedAt > Date.now() ||
                        Date.now() - candidate.savedAt >= 7 * 86400000 ||
                        !/^(classic|neo-minimalist)$/.test(candidate.presetId)
                    )
                        continue;
                    if (version === 3) {
                        if (!candidate.colors || typeof candidate.colors !== 'object') continue;
                        var names = Object.keys(candidate.colors);
                        if (
                            names.some(function (name) {
                                return !allowed.test(name) || !/^#[0-9a-f]{6}$/i.test(candidate.colors[name]);
                            }) ||
                            !candidate.colors['--bg'] ||
                            !candidate.colors['--text']
                        )
                            continue;
                    }
                    return candidate;
                } catch (e) {}
            }
        }
        // v2 contributes its preset choice only, never its obsolete classic-blue colors.
        // v1 may contain merchant-derived themes from before skin unification.
        var payload = readCache('__storefront_theme_v3__', 3) || readCache('__storefront_theme_v2__', 2);
        if (!payload) return;
        var root = document.documentElement;
        // Both page backgrounds are unchanged. Keep legacy neo loads dark until runtime applies
        // the current shared palette, without duplicating the rest of that palette here.
        var colors =
            payload.version === 3
                ? payload.colors
                : { '--bg': payload.presetId === 'neo-minimalist' ? '#070b14' : '#f1f5f9' };
        var names = Object.keys(colors);
        names.forEach(function (name) {
            root.style.setProperty(name, colors[name]);
        });
        root.setAttribute('data-storefront-preset', payload.presetId);
        root.setAttribute('data-storefront-theme-channel', payload.channelCode);
        var scheme = payload.presetId === 'neo-minimalist' ? 'dark' : 'light';
        root.style.setProperty('color-scheme', scheme);
        document.querySelector('meta[name="theme-color"]').content = colors['--bg'];
        document.querySelector('meta[name="color-scheme"]').content = scheme;
        if (payload.version === 3) root.removeAttribute('data-storefront-theme-pending');
    } catch (e) {}
})();
