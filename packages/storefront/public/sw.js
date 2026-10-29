self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches
            .keys()
            .then(keys => Promise.all(keys.map(key => caches.delete(key))))
            .then(() => self.registration.unregister())
            // This retired worker has no fetch handler. Release cached assets and
            // claim existing clients without replacing their visible document.
            .then(() => self.clients.claim()),
    );
});
