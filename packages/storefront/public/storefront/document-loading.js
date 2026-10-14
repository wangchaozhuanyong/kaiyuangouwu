// Parser-time presentation only. Queries and readiness remain owned by the app.
(function () {
    if (new URLSearchParams(location.search).get('storefrontPreviewEmbedded') === '1') return;
    var html = document.documentElement;
    var settled = false;
    var leaving = false;
    var startupFailed = false;
    var startupTimer;
    var recoveryTimer;
    function stopStartupWatch() {
        clearTimeout(startupTimer);
        window.removeEventListener('error', resourceFailed, true);
    }
    function present() {
        html.setAttribute('data-storefront-boot-pending', '');
        var boot = document.getElementById('storefront-boot-loading');
        if (boot) {
            boot.removeAttribute('aria-hidden');
            boot.setAttribute('aria-busy', startupFailed ? 'false' : 'true');
        }
        var root = document.getElementById('root');
        if (root) root.inert = true;
    }
    function finish() {
        stopStartupWatch();
        settled = true;
        leaving = false;
        startupFailed = false;
        clearTimeout(recoveryTimer);
        html.removeAttribute('data-storefront-boot-pending');
        html.removeAttribute('data-storefront-boot-error');
        var failure = document.getElementById('storefront-boot-error');
        if (failure) failure.remove();
        var boot = document.getElementById('storefront-boot-loading');
        if (boot) {
            boot.setAttribute('aria-hidden', 'true');
            boot.setAttribute('aria-busy', 'false');
        }
        var root = document.getElementById('root');
        if (root) root.inert = false;
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
            ? '页面暂时无法加载，请重试'
            : 'This page could not be loaded. Try again.';
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
    function parsed() {
        if (startupFailed) showStartupFailure();
        else if (!settled) present();
    }
    present();
    // This deadline covers the period before React can mount its own error boundary.
    // Query deadlines remain entirely within PageReadinessBoundary.
    startupTimer = setTimeout(showStartupFailure, 10000);
    window.addEventListener('error', resourceFailed, true);
    document.addEventListener('DOMContentLoaded', parsed, { once: true });
    // Server-rendered markup being present does not mean its controls work yet.
    document.addEventListener('storefront:page-ready', function () {
        if (!leaving) finish();
    });
    document.addEventListener('storefront:page-error', finish);
    window.addEventListener('pageshow', function (event) {
        if (event.persisted) finish();
    });
    window.addEventListener('beforeunload', function (event) {
        if (!settled) return;
        // This never cancels navigation or asks the browser to show a prompt.
        queueMicrotask(function () {
            if (event.defaultPrevented || event.returnValue) return;
            leaving = true;
            present();
            // A cancelled/failed document navigation must not strand the old page.
            recoveryTimer = setTimeout(finish, 10000);
        });
    });
    window.addEventListener('focus', function () {
        if (leaving) finish();
    });
})();
