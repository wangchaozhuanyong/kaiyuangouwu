// Document startup and native scroll handoff. React owns SPA queries and loading states.
(function () {
    if (new URLSearchParams(location.search).get('storefrontPreviewEmbedded') === '1') return;
    var html = document.documentElement;
    var settled = false;
    var startupFailed = false;
    var startupTimer;
    var feedbackTimer;
    function documentScrollRestoration(mode) {
        try {
            if ('scrollRestoration' in history) history.scrollRestoration = mode;
        } catch (e) {}
    }
    function stopStartupWatch() {
        clearTimeout(startupTimer);
        clearTimeout(feedbackTimer);
        window.removeEventListener('error', resourceFailed, true);
    }
    function present() {
        if (settled) return;
        var boot = document.getElementById('storefront-boot-loading');
        var root = document.getElementById('root');
        html.setAttribute('data-storefront-boot-pending', '');
        if (boot) {
            // Existing server content stays visible and native links remain usable.
            // Only an empty document uses the full brand presentation.
            boot.setAttribute('data-presentation', root && root.hasChildNodes() ? 'status' : 'initial');
            boot.removeAttribute('aria-hidden');
            boot.setAttribute('aria-busy', startupFailed ? 'false' : 'true');
        }
    }
    function finish() {
        stopStartupWatch();
        document.removeEventListener('click', beforeAppAction, true);
        document.removeEventListener('submit', beforeAppAction, true);
        settled = true;
        html.removeAttribute('data-storefront-boot-pending');
        html.removeAttribute('data-storefront-boot-error');
        var failure = document.getElementById('storefront-boot-error');
        if (failure) failure.remove();
        var boot = document.getElementById('storefront-boot-loading');
        if (boot) {
            boot.setAttribute('aria-hidden', 'true');
            boot.setAttribute('aria-busy', 'false');
        }
    }
    function showStartupFailure() {
        if (settled) return;
        stopStartupWatch();
        startupFailed = true;
        html.setAttribute('data-storefront-boot-error', '');
        present();
        var boot = document.getElementById('storefront-boot-loading');
        if (!boot || document.getElementById('storefront-boot-error')) return;
        var chinese = html.lang.toLowerCase().indexOf('zh') === 0;
        var failure = document.createElement('div');
        failure.id = 'storefront-boot-error';
        failure.className = 'page-readiness-error';
        failure.setAttribute('role', 'alert');
        var message = document.createElement('p');
        message.textContent = chinese
            ? '交互暂时无法启动，请重新加载'
            : 'Interactive controls could not start. Reload the page.';
        var actions = document.createElement('div');
        actions.className = 'page-readiness-error-actions';
        var retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = chinese ? '重新加载' : 'Reload page';
        retry.addEventListener('click', function () {
            location.reload();
        });
        actions.appendChild(retry);
        failure.appendChild(message);
        failure.appendChild(actions);
        boot.appendChild(failure);
    }
    function resourceFailed(event) {
        var script = event.target;
        if (script && script.tagName === 'SCRIPT' && script.type === 'module' && !script.async && script.src)
            showStartupFailure();
    }
    function beforeAppAction(event) {
        var target = event.target;
        var action =
            event.type === 'submit'
                ? target
                : target && typeof target.closest === 'function'
                  ? target.closest('button')
                  : null;
        var root = document.getElementById('root');
        if (!action || action.disabled || !root || !root.contains(action)) return;
        // Native links remain available. An unattached JS control gives feedback;
        // never queue or replay a purchase, form submission or other operation.
        event.preventDefault();
        event.stopImmediatePropagation();
        present();
        var label = document.querySelector('#storefront-boot-loading .brand-loading-label');
        if (label && !startupFailed)
            label.textContent =
                html.lang.toLowerCase().indexOf('zh') === 0
                    ? '交互正在准备，请稍候'
                    : 'Preparing controls. Please wait.';
    }
    function parsed() {
        if (html.hasAttribute('data-storefront-app-owned')) return finish();
        if (startupFailed) return showStartupFailure();
        var root = document.getElementById('root');
        if (!root || !root.hasChildNodes()) present();
    }
    // This deadline covers startup only, never route data, images or background reads.
    startupTimer = setTimeout(showStartupFailure, 10000);
    feedbackTimer = setTimeout(present, 200);
    window.addEventListener('error', resourceFailed, true);
    document.addEventListener('storefront:app-owned', finish);
    document.addEventListener('storefront:page-error', finish);
    document.addEventListener('click', beforeAppAction, true);
    document.addEventListener('submit', beforeAppAction, true);
    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', parsed, { once: true });
    else parsed();
    window.addEventListener('pagehide', function () {
        // Router uses manual restoration inside the app. A replacement document
        // needs native restoration before its first paint, ahead of React startup.
        documentScrollRestoration('auto');
    });
    window.addEventListener('pageshow', function (event) {
        if (html.hasAttribute('data-storefront-app-owned')) {
            documentScrollRestoration('manual');
            if (event.persisted) finish();
        }
    });
    // Do not hide the old page on beforeunload. The browser retains it until the
    // next document arrives; cancelled navigation and back/forward stay usable.
})();
