import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const nginx = readFileSync(new URL('./nginx/damatong.conf', import.meta.url), 'utf8');
const storefrontIndex = readFileSync(new URL('../packages/storefront/index.html', import.meta.url), 'utf8');

test('the production shell injects a host-resolved preload through an internal bounded subrequest', () => {
    assert.match(storefrontIndex, /<!--# include virtual="\/_storefront\/lcp-preload" -->/u);
    assert.match(
        nginx,
        new RegExp(
            'location = /_storefront/lcp-preload \\{[\\s\\S]*?internal;' +
                '[\\s\\S]*?proxy_pass http://vendure_backend/storefront/lcp-preload;' +
                '[\\s\\S]*?proxy_read_timeout 500ms;[\\s\\S]*?\\}',
            'u',
        ),
    );
    assert.match(nginx, /location = \/index\.html \{[\s\S]*?ssi on;[\s\S]*?ssi_silent_errors on;/u);
});
