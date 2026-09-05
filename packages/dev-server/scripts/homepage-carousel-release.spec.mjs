import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const deploy = await readFile(path.join(repositoryRoot, 'deploy/deploy-production-from-s3.sh'), 'utf8');
const build = await readFile(
    path.join(repositoryRoot, '.github/workflows/build_production_runtime.yml'),
    'utf8',
);
const keys = 'home-hero-token-topup-v1,home-hero-codex-tiers-v1,home-hero-account-services-v1';
const sha = 'a'.repeat(40);

function guardEnvironment(carousel, channel = '__default_channel__', media = keys) {
    return {
        PATH: process.env.PATH,
        VENDURE_REVIEWED_HOMEPAGE_CAROUSEL: carousel,
        VENDURE_REVIEWED_STOREFRONT_MEDIA_CHANNEL_CODES: channel,
        VENDURE_REVIEWED_STOREFRONT_MEDIA_KEYS: media,
    };
}

function runDeployInputGuard(env) {
    return spawnSync(
        'bash',
        [
            '-c',
            deploy.split('\numask 027')[0],
            'guard-test',
            sha,
            sha + '-1-1-linux-x64',
            's3://yunqiao-vendure-prod-backup-079740175286-apne1/deployments/' + sha,
        ],
        { env, encoding: 'utf8' },
    );
}

void test('carousel input guard permits empty bootstrap and the exact reviewed scope only', () => {
    assert.equal(runDeployInputGuard(guardEnvironment('false', '', '')).status, 0);
    assert.equal(runDeployInputGuard(guardEnvironment('true')).status, 0);
    for (const env of [
        guardEnvironment('yes'),
        guardEnvironment('true', 'my-malaysia'),
        guardEnvironment('true', '__default_channel__,my-malaysia'),
        guardEnvironment('true', '__default_channel__', ''),
        guardEnvironment('true', '__default_channel__', keys + ',unreviewed-media'),
    ]) {
        const result = runDeployInputGuard(env);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /homepage carousel/u);
    }
});

void test('workflow rejects invalid carousel scope before checkout', () => {
    const source = build.split('run: |')[1].split('- name: Checkout target commit')[0];
    for (const [carousel, channel, media, succeeds] of [
        ['false', '', '', true],
        ['true', '__default_channel__', keys, true],
        ['true', 'my-malaysia', keys, false],
        ['true', '__default_channel__', 'unreviewed-media', false],
        ['true', '__default_channel__', '', false],
        ['invalid', '', '', false],
    ]) {
        const result = spawnSync('bash', ['-c', source], {
            env: {
                PATH: process.env.PATH,
                TARGET_SHA: sha,
                HOMEPAGE_CAROUSEL: carousel,
                MEDIA_CHANNEL_CODES: channel,
                MEDIA_KEYS: media,
                AUTH_VISUALS: 'false',
                MOYAO_BRAND: 'false',
                DAMATONG_STOREFRONT: 'false',
                DAMATONG_CHANNEL_TOKEN: '',
            },
            encoding: 'utf8',
        });
        assert.equal(result.status === 0, succeeds, result.stderr);
    }
});

void test('carousel change guard rejects missing approval and unexpected approval', () => {
    const source = deploy.slice(
        deploy.indexOf('homepage_carousel_change=false'),
        deploy.indexOf('mapfile -t managed_storefront_changes'),
    );
    for (const [changed, reviewed, succeeds] of [
        [false, 'false', true],
        [true, 'true', true],
        [true, 'false', false],
        [false, 'true', false],
    ]) {
        const result = spawnSync(
            'bash',
            [
                '-c',
                'fail() { echo "$1" >&2; exit 1; }\ngit() { return ' +
                    (changed ? '1' : '0') +
                    '; }\n' +
                    source,
            ],
            { env: { PATH: process.env.PATH, reviewed_homepage_carousel: reviewed }, encoding: 'utf8' },
        );
        assert.equal(result.status === 0, succeeds, result.stderr);
    }
});

void test('carousel release chain verifies both endpoints before promoting the client', async () => {
    const downstream = await readFile(
        path.join(repositoryRoot, '.github/workflows/deploy_production_runtime.yml'),
        'utf8',
    );
    assert.match(build, /--argjson homepageCarousel "\$HOMEPAGE_CAROUSEL"/u);
    assert.match(build, /homepageCarousel: \$homepageCarousel/u);
    assert.match(downstream, /\.homepageCarousel \| type == "boolean"/u);
    assert.match(downstream, /VENDURE_REVIEWED_HOMEPAGE_CAROUSEL/u);
    assert.match(downstream, /HOMEPAGE_CAROUSEL_\|Runtime artifact verified/u);
    assert.match(deploy, /packages\/dev-server\/scripts\/sync-homepage-carousel\.mjs/u);
    assert.match(deploy, /packages\/storefront\/src\/assets\/storefront\/carousel\//u);
    assert.match(deploy, /VENDURE_REVIEWED_HOMEPAGE_CAROUSEL="\$\{reviewed_homepage_carousel\}"/u);
    assert.equal((deploy.match(/HOMEPAGE_CAROUSEL_CHANNEL_CODES="/gu) ?? []).length, 3);
    assert.ok(
        deploy.indexOf('HOMEPAGE_CAROUSEL_PREFLIGHT_OK') < deploy.indexOf('vendure-mysql-backup.service'),
    );
    assert.ok(
        deploy.indexOf('PRODUCTION_API_READY phase=post-switch') <
            deploy.indexOf('HOMEPAGE_CAROUSEL_PUBLISH_BEGIN'),
    );
    assert.ok(
        deploy.indexOf('sync-homepage-carousel.mjs --apply --allow-remote') <
            deploy.indexOf('sync-homepage-carousel.mjs --verify'),
    );
    assert.ok(
        deploy.indexOf('HOMEPAGE_CAROUSEL_VERIFY_OK') <
            deploy.indexOf('sudo -n ln -s "' + '$' + '{candidate}"'),
    );
    assert.match(deploy, /PRODUCTION_BOOTSTRAP_VERIFIED sha=%s homepage_carousel_guard=enabled/u);
    assert.match(deploy, /cmp --silent "\$\{repository\}\/deploy\/deploy-production-from-s3.sh"/u);
});
