// @vitest-environment jsdom
import { ApolloProvider } from '@apollo/client/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createCatalogSyncFixture } from '../../../fixtures/catalog-sync/model';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { CatalogContinuousSyncPanel } from './CatalogContinuousSyncPanel';

const cleanups: Array<() => void> = [];
afterEach(async () => {
    await act(async () => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });
});
async function setup(options: Parameters<typeof createCatalogSyncFixture>[0] = {}) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const fixture = createCatalogSyncFixture(options);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(() => {
        root.unmount();
        fixture.client.stop();
        container.remove();
    });
    const render = async (active = true) =>
        act(async () =>
            root.render(
                <ApolloProvider client={fixture.client}>
                    <FeatureHelpProvider>
                        <CatalogContinuousSyncPanel
                            active={active}
                            stores={fixture.stores}
                            categories={fixture.categories}
                        />
                    </FeatureHelpProvider>
                </ApolloProvider>,
            ),
        );
    await render();
    const button = (text: string) =>
        [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === text)!;
    const click = (text: string) => act(async () => button(text).click());
    const select = (name: string, value: string) =>
        act(async () => {
            const input = container.querySelector(`select[aria-label="${name}"]`) as HTMLSelectElement;
            input.value = value;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
    const check = (text: string) =>
        act(async () => {
            const label = [...container.querySelectorAll('label')].find(
                label => label.querySelector('input[type="checkbox"]') && label.textContent?.includes(text),
            )!;
            (label.querySelector('input') as HTMLInputElement).click();
        });
    const create = async () => {
        await select('持续同步来源店铺', 'a');
        await select('持续同步来源分类', 'source-category');
        await check('销售店铺 B');
        await click('保存为关闭的规则');
    };
    return { ...fixture, container, render, button, click, select, check, create };
}
describe('continuous category synchronization administration', () => {
    it('explains the preview and enable workflow without changing synchronization rules', async () => {
        const page = await setup();
        const help = page.container.querySelector<HTMLButtonElement>(
            'button[aria-label="查看“分类持续同步与共用货源”功能说明"]',
        )!;
        await act(async () => help.click());
        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog?.textContent).toContain('先保存关闭的规则，再检查同步预览后启用');
        expect(dialog?.textContent).toContain('不会作为已完成同步处理');
        expect(page.state.operations.filter(operation => operation.name === 'SaveSyncRule')).toHaveLength(0);
        expect(page.state.operations.filter(operation => operation.name === 'EnableSyncRule')).toHaveLength(
            0,
        );
    });
    it('saves a disabled all-descendant rule and enables only the reviewed preview', async () => {
        const page = await setup();
        await page.create();
        expect(page.state.rules[0].enabled).toBe(false);
        expect(page.state.rules[0].includeDescendants).toBe(true);
        await page.click('生成同步预览');
        expect(page.container.textContent).toContain('102 个商品，2 个分类');
        expect(page.container.textContent).toContain('待配置');
        await page.click('启用此分类持续同步');
        expect(page.state.rules[0].enabled).toBe(true);
        expect(page.container.textContent).toContain('等待同步');
        expect(page.state.operations.filter(operation => operation.name === 'EnableSyncRule')).toHaveLength(
            1,
        );
    });
    it('requires explicit acknowledgement before taking over existing target configuration', async () => {
        const page = await setup({ takeover: true });
        await page.create();
        await page.click('生成同步预览');
        expect(page.button('启用此分类持续同步').disabled).toBe(true);
        await page.check('已核对并确认接管');
        expect(page.button('启用此分类持续同步').disabled).toBe(false);
        await page.click('启用此分类持续同步');
        expect(
            page.state.operations.find(operation => operation.name === 'EnableSyncRule')?.variables
                .acceptTakeover,
        ).toBe(true);
    });
    it('separates successful saves from readback failures and retries only the read', async () => {
        const page = await setup({ failReadback: true });
        await page.create();
        expect(page.state.rules).toHaveLength(1);
        expect(page.container.textContent).toContain('操作已完成');
        await page.click('刷新同步状态');
        expect(page.state.operations.filter(operation => operation.name === 'SaveSyncRule')).toHaveLength(1);
        expect(page.container.textContent).toContain('生成同步预览');
    });
    it('retains unfinished form values while the panel is hidden', async () => {
        const page = await setup();
        await page.select('持续同步来源店铺', 'a');
        await page.select('持续同步来源分类', 'source-category');
        await page.render(false);
        await page.render(true);
        expect(
            (page.container.querySelector('select[aria-label="持续同步来源分类"]') as HTMLSelectElement)
                .value,
        ).toBe('source-category');
        expect(page.state.operations.filter(operation => operation.name === 'SaveSyncRule')).toHaveLength(0);
    });
});
