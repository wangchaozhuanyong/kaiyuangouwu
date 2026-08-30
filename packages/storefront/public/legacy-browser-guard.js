(function () {
    'use strict';

    var userAgent = window.navigator.userAgent || '';
    var isTrident =
        !!window.document.documentMode ||
        userAgent.indexOf('MSIE ') !== -1 ||
        userAgent.indexOf('Trident/') !== -1;

    if (!isTrident || window.location.pathname === '/unsupported-browser.html') {
        return;
    }

    var source = window.location.pathname + window.location.search + window.location.hash;
    var target = '/unsupported-browser.html?from=' + encodeURIComponent(source);
    window.location.replace(target);
})();
