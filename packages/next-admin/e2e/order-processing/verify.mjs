import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const output = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../artifacts/order-processing/closure-20261004',
);
const origin = process.env.ORDER_PROCESSING_TEST_ORIGIN || 'http://127.0.0.1:5192';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
const pageErrors = [];
const externalRequests = [];
const results = [];
page.on('pageerror', error => pageErrors.push(error.message));
await page.route('**/*', route => {
    const url = route.request().url();
    if ((url.startsWith(origin + '/') || url.startsWith('data:')) && !url.includes('/admin-api'))
        return route.continue();
    externalRequests.push(url);
    return route.abort();
});
const open = async query => {
    await page.goto(origin + '/e2e/order-processing/index.html?' + query);
    await expect(page.getByText('没有生产、资金或邮件连接', { exact: false })).toBeVisible();
};
const writes = () => page.evaluate(() => window.orderProcessingFixture.writes);
const capture = name => page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
const overflow = () =>
    page.evaluate(() => ({
        viewport: innerWidth,
        body: document.body.scrollWidth,
        document: document.documentElement.scrollWidth,
    }));
const manualIncremental = process.argv.includes('--manual-incremental');
async function verifyManualIncremental() {
    await open('order=DIGITAL&append-one&no-reveal');
    await page
        .getByRole('region', { name: '订单处理进度' })
        .getByRole('button', { name: '补交新增成品', exact: true })
        .click();
    const editor = page.getByRole('region', { name: '交付任务详情', exact: true });
    await expect(editor.getByRole('button', { name: '查看已有交付内容', exact: true })).toHaveCount(0);
    await editor.getByRole('button', { name: '补交新增成品', exact: true }).click();
    await expect(page.getByLabel('新增成品包 1 账号', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('成品包 1 账号', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toHaveCount(0);
    await expect(editor).toContainText('应补交 1 件');
    await page.getByLabel('批量成品 TSV', { exact: true }).fill('SYNTHETIC-ADDED\t\t追加的合成成品');
    await page.getByRole('button', { name: '校验并预览', exact: true }).click();
    await page.getByRole('button', { name: '应用到草稿', exact: true }).click();
    expect(await writes()).toEqual([]);
    await capture('manual-append-desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    const appendWidths = await overflow();
    expect(appendWidths.document).toBeLessThanOrEqual(390);
    await capture('manual-append-mobile');
    await page.getByRole('button', { name: '确认补交内容', exact: true }).click();
    expect(await writes()).toEqual([]);
    await page.getByRole('button', { name: '补交并发送通知', exact: true }).click();
    await expect(
        page.getByText('新增 1 件成品已补交，原成品保留；安全领取通知已进入队列，发送与领取结果待核实', {
            exact: true,
        }),
    ).toBeVisible();
    expect(await writes()).toEqual([
        { operation: 'NextAdminAppendManualDelivery', input: { id: 'DIGITAL-task', packageCount: 1 } },
    ]);
    expect(await page.evaluate(() => window.orderProcessingFixture.appendChecks)).toEqual([
        { originalCount: 2, addedCount: 1, totalCount: 3, originalsRetained: true },
    ]);
    expect(await page.evaluate(() => window.orderProcessingTaskMetadata('DIGITAL-task'))).toEqual({
        quantity: 3,
        eligibleQuantity: 3,
        state: 'SENDING',
        packageCount: 3,
    });
    expect(
        await page.evaluate(() =>
            window.orderProcessingFixture.reads.includes('NextAdminRevealManualDelivery'),
        ),
    ).toBe(false);
    results.push({
        scenario:
            'published two packages append only the missing one without old secret access or server draft; original packages remain and confirmed task quantity becomes three',
        passed: true,
        desktopWidth: 1440,
        mobile: appendWidths,
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await open('order=DIGITAL&eligible-one');
    await page
        .getByRole('region', { name: '订单处理进度' })
        .getByRole('button', { name: '准备交付', exact: true })
        .click();
    await expect(page.getByRole('region', { name: '交付任务详情', exact: true })).toContainText(
        '应交付 1 件',
    );
    await expect(page.getByLabel('成品包 2 账号', { exact: true })).toHaveCount(0);
    await page
        .getByLabel('批量成品 TSV', { exact: true })
        .fill('SYNTHETIC-A\t\t第一件\nSYNTHETIC-B\t\t第二件');
    await page.getByRole('button', { name: '校验并预览', exact: true }).click();
    await expect(page.getByRole('button', { name: '应用到草稿', exact: true })).toBeDisabled();
    await page
        .getByLabel('批量成品 TSV', { exact: true })
        .fill('SYNTHETIC-REMAINING\t\t购买2件退1件后交付1件');
    await page.getByRole('button', { name: '校验并预览', exact: true }).click();
    await page.getByRole('button', { name: '应用到草稿', exact: true }).click();
    await capture('manual-refund-remaining-desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    const remainingWidths = await overflow();
    expect(remainingWidths.document).toBeLessThanOrEqual(390);
    await capture('manual-refund-remaining-mobile');
    await page.getByRole('button', { name: '发布交付', exact: true }).click();
    await page.getByRole('button', { name: '发布并通知买家', exact: true }).click();
    await expect(
        page.getByText('成品已发布，领取通知已进入发送队列；通知与领取结果待核实', { exact: true }),
    ).toBeVisible();
    expect(await writes()).toEqual([
        { operation: 'NextAdminPublishManualDelivery', input: { id: 'DIGITAL-task', packageCount: 1 } },
    ]);
    expect(await page.evaluate(() => window.orderProcessingTaskMetadata('DIGITAL-task'))).toEqual({
        quantity: 1,
        eligibleQuantity: 1,
        state: 'SENDING',
        packageCount: 1,
    });
    results.push({
        scenario:
            'two purchased units minus one settled item refund require and publish exactly one eligible package',
        passed: true,
        desktopWidth: 1440,
        mobile: remainingWidths,
    });
}
try {
    if (manualIncremental) await verifyManualIncremental();
    else {
        await open('list');
        await expect(page.getByRole('heading', { name: '订单处理台' })).toBeVisible();
        await expect(page.getByRole('button', { name: '待处理', exact: true })).toHaveAttribute(
            'aria-current',
            'page',
        );
        await expect(page.getByText('四项进度 / 下一步', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '准备交付', exact: true })).toBeVisible();
        await capture('orders-desktop');
        results.push({
            scenario: 'formal order processing list defaults to pending and shows explicit next steps',
            passed: true,
            width: 1440,
            overflow: await overflow(),
        });
        await page.getByRole('button', { name: '准备交付', exact: true }).click();
        await expect(page.getByRole('region', { name: '订单处理进度' })).toBeVisible();
        await page.getByRole('button', { name: '准备交付', exact: true }).click();
        await expect(page.getByRole('region', { name: '交付任务详情', exact: true })).toBeVisible();
        await page.getByLabel('成品包 1 账号', { exact: true }).fill('SYNTHETIC-EXAMPLE-NO-ACCOUNT');
        await page
            .getByLabel('成品包 1 交付说明', { exact: true })
            .fill('合成内容，仅验收浏览器，不向任何邮箱发送。');
        await capture('digital-editor-desktop');
        await page.getByRole('button', { name: '发布交付', exact: true }).click();
        await page.getByRole('button', { name: '发布并通知买家', exact: true }).click();
        await expect(
            page.getByText('成品已发布，领取通知已进入发送队列；通知与领取结果待核实', { exact: true }),
        ).toBeVisible();
        expect(
            (await writes()).filter(item => item.operation === 'NextAdminPublishManualDelivery'),
        ).toHaveLength(1);
        await expect(page.getByText('通知发送中', { exact: true })).toBeVisible();
        await capture('digital-published-desktop');
        results.push({
            scenario:
                'formal detail embeds manual task and publishes synthetic content; notification remains queued and claim unknown',
            passed: true,
        });

        await open('order=DIGITAL&batch');
        await page
            .getByRole('region', { name: '订单处理进度' })
            .getByRole('button', { name: '准备交付', exact: true })
            .click();
        const batchInput = page.getByLabel('批量成品 TSV', { exact: true });
        await batchInput.fill('SYNTHETIC-A\t\t第一件');
        await page.getByRole('button', { name: '校验并预览', exact: true }).click();
        await expect(page.getByRole('button', { name: '应用到草稿', exact: true })).toBeDisabled();
        expect(await writes()).toEqual([]);
        await batchInput.fill(
            'SYNTHETIC-A\tdummy-a-no-credential\t说明\t含逗号,及竖线|\n\n\t\t第二件仅说明\nSYNTHETIC-C\tdummy-c-no-credential\t',
        );
        await page.getByRole('button', { name: '校验并预览', exact: true }).click();
        const batchPreview = page.getByRole('region', { name: '批量成品预览', exact: true });
        await expect(batchPreview).toContainText('识别 3 件 / 应交付 3 件');
        await expect(batchPreview).toContainText('已跳过空行 1 行');
        expect(await batchPreview.innerText()).not.toContain('dummy-a-no-credential');
        await expect(page.getByLabel('成品包 1 账号', { exact: true })).toHaveValue('');
        await capture('digital-batch-preview-desktop');
        await page.getByRole('button', { name: '应用到草稿', exact: true }).click();
        await expect(batchInput).toHaveValue('');
        await expect(page.getByLabel('成品包 1 交付说明', { exact: true })).toHaveValue(
            '说明\t含逗号,及竖线|',
        );
        expect(await writes()).toEqual([]);
        await page.getByRole('button', { name: '保存草稿', exact: true }).click();
        await expect(page.getByText('人工交付草稿已保存', { exact: true })).toBeVisible();
        expect(await writes()).toEqual([
            { operation: 'NextAdminSaveManualDeliveryDraft', input: { id: 'DIGITAL-task', packageCount: 3 } },
        ]);
        await page
            .getByRole('region', { name: '订单处理进度' })
            .getByRole('button', { name: '准备交付', exact: true })
            .click();
        await expect(page.getByLabel('成品包 1 交付说明', { exact: true })).toHaveCount(0);
        await page.getByRole('button', { name: '查看已有交付内容', exact: true }).click();
        await expect(page.getByLabel('成品包 1 交付说明', { exact: true })).toHaveValue(
            '说明\t含逗号,及竖线|',
        );
        expect(await page.evaluate(() => window.orderProcessingCacheContainsSyntheticSecret())).toBe(false);
        await page.getByRole('button', { name: '发布交付', exact: true }).click();
        await page.getByRole('button', { name: '发布并通知买家', exact: true }).click();
        await expect(
            page.getByText('成品已发布，领取通知已进入发送队列；通知与领取结果待核实', { exact: true }),
        ).toBeVisible();
        expect((await writes()).map(item => [item.operation, item.input.packageCount])).toEqual([
            ['NextAdminSaveManualDeliveryDraft', 3],
            ['NextAdminPublishManualDelivery', 3],
        ]);
        results.push({
            scenario:
                'batch TSV rejects mismatched units, masks preview secrets, applies explicitly and saves before separately publishing the same three packages',
            passed: true,
        });

        await open('order=DIGITAL&existing&no-reveal');
        await page
            .getByRole('region', { name: '订单处理进度' })
            .getByRole('button', { name: '准备交付', exact: true })
            .click();
        await expect(
            page.getByText('查看已有内容需要专用交付查看权限；仍可查看任务和通知记录。', { exact: true }),
        ).toBeVisible();
        await expect(page.getByRole('button', { name: '查看已有交付内容', exact: true })).toHaveCount(0);
        await expect(page.getByLabel('批量成品 TSV', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: '发布交付', exact: true })).toHaveCount(0);
        expect(
            await page.evaluate(() =>
                window.orderProcessingFixture.reads.includes('NextAdminRevealManualDelivery'),
            ),
        ).toBe(false);
        expect(await page.evaluate(() => window.orderProcessingCacheContainsSyntheticSecret())).toBe(false);
        await capture('existing-content-locked-desktop');
        results.push({
            scenario:
                'metadata-only existing delivery cannot be overwritten or implicitly revealed without the dedicated permission',
            passed: true,
        });
        await open('order=DIGITAL&existing');
        await page
            .getByRole('region', { name: '订单处理进度' })
            .getByRole('button', { name: '准备交付', exact: true })
            .click();
        await expect(page.getByLabel('成品包 1 账号', { exact: true })).toHaveCount(0);
        await page.getByRole('button', { name: '查看已有交付内容', exact: true }).click();
        await expect(page.getByLabel('成品包 1 账号', { exact: true })).toHaveValue('SYNTHETIC-EXISTING');
        expect(await page.evaluate(() => window.orderProcessingCacheContainsSyntheticSecret())).toBe(false);
        await page
            .getByRole('region', { name: '交付任务详情', exact: true })
            .getByRole('button', { name: '关闭', exact: true })
            .click();
        await page
            .getByRole('region', { name: '订单处理进度' })
            .getByRole('button', { name: '准备交付', exact: true })
            .click();
        await expect(page.getByLabel('成品包 1 账号', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: '查看已有交付内容', exact: true })).toBeVisible();
        expect(await writes()).toEqual([]);
        results.push({
            scenario:
                'explicit no-cache reveal is scoped to the open editor and closing requires a new deliberate reveal',
            passed: true,
        });

        await open('order=CANCELLED');
        await expect(page.getByRole('button', { name: '处理退款', exact: true })).toBeVisible();
        await page.getByRole('button', { name: '处理退款', exact: true }).click();
        const refundDialog = page.getByRole('dialog', { name: '创建原支付渠道退款' });
        await expect(refundDialog).toBeVisible();
        await expect(refundDialog.getByRole('option', { name: '实物运费退款' })).toHaveCount(0);
        await refundDialog.getByLabel('人工数字成品（合成商品）退款份数', { exact: true }).fill('1');
        await refundDialog.locator('input:not([type="number"]):not([type="password"])').fill('5.00');
        await refundDialog.locator('textarea').fill('合成按件退款，不产生资金交易');
        await refundDialog.locator('input[type="password"]').fill('synthetic-confirmation-no-credential');
        await capture('cancelled-item-refund-desktop');
        await refundDialog.getByRole('button', { name: '提交退款', exact: true }).click();
        await expect(refundDialog).toHaveCount(0);
        const itemWrite = (await writes()).find(item => item.operation === 'RefundSalesOrder');
        expect(itemWrite.input.lines).toEqual([{ orderLineId: 'CANCELLED-line', quantity: 1 }]);
        expect(itemWrite.input.reasonType).toBe('ITEMS');
        await expect(page.getByRole('button', { name: '登记人工退款凭证', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '取消支付授权', exact: true })).toHaveCount(0);
        results.push({
            scenario:
                'cancelled paid order still requires funds processing; item refund carries selected units; settled money cannot cancel',
            passed: true,
        });

        await open('order=DIGITAL');
        await page.getByRole('button', { name: '申请退款', exact: true }).click();
        const compensation = page.getByRole('dialog', { name: '创建原支付渠道退款' });
        await compensation.getByLabel('退款用途').selectOption('COMPENSATION');
        await expect(compensation.locator('input[type="number"]')).toHaveCount(0);
        await compensation.locator('input:not([type="password"])').fill('2.00');
        await compensation.locator('textarea').fill('合成金额补偿，保留交付权益');
        await compensation.locator('input[type="password"]').fill('synthetic-confirmation-no-credential');
        await compensation.getByRole('button', { name: '提交退款', exact: true }).click();
        await expect(compensation).toHaveCount(0);
        const compensationWrite = (await writes()).find(item => item.operation === 'RefundSalesOrder');
        expect(compensationWrite.input.reasonType).toBe('COMPENSATION');
        expect(compensationWrite.input.lines).toEqual([]);
        expect(compensationWrite.input.shipping).toBe(0);
        results.push({
            scenario: 'compensation retains entitlement units and carries distinct reason type',
            passed: true,
        });

        await open('order=TEST');
        await expect(page.getByRole('button', { name: '申请退款', exact: true })).toBeDisabled();
        await expect(page.getByText('模拟订单 · 无真实资金退款', { exact: true })).toBeVisible();
        expect(await writes()).toEqual([]);
        await capture('simulated-payment-desktop');
        results.push({ scenario: 'simulated payment has no executable real refund', passed: true });

        await open('order=RETRY&retry-response-loss');
        await expect(page.getByText('退款失败，需处理原申请', { exact: true })).toBeVisible();
        await expect(page.getByText('已完成交付', { exact: true }).first()).toBeVisible();
        await page.getByRole('button', { name: '处理原失败退款', exact: true }).click();
        await expect(page.getByRole('button', { name: '重试原退款', exact: true })).toBeFocused();
        await page.getByRole('button', { name: '重试原退款', exact: true }).click();
        const retryDialog = page.getByRole('dialog', { name: '确认资金操作', exact: true });
        await retryDialog
            .getByLabel('当前管理员密码', { exact: true })
            .fill('synthetic-confirmation-no-credential');
        await retryDialog.getByRole('button', { name: '验证并执行', exact: true }).click();
        await expect(retryDialog.getByRole('alert')).toBeVisible();
        const originalRetry = (await writes())[0];
        await retryDialog.getByRole('button', { name: '验证并执行', exact: true }).click();
        await expect(retryDialog).toHaveCount(0);
        const refundRetries = await writes();
        expect(refundRetries).toHaveLength(2);
        expect(refundRetries[0]).toEqual(refundRetries[1]);
        expect(originalRetry.operation).toBe('NextAdminRetryRefund');
        expect(originalRetry.input.refundId).toBe('fixture-failed-refund');
        expect(originalRetry.input.idempotencyKey).toBeTruthy();
        expect(Object.keys(originalRetry.input).sort()).toEqual(['idempotencyKey', 'refundId']);
        await expect(page.getByRole('button', { name: '登记人工退款凭证', exact: true })).toBeVisible();
        await capture('failed-refund-retry-desktop');
        results.push({
            scenario:
                'failed refund main action focuses original funds record; protected retry survives lost response with same attempt key and keeps manual verification pending',
            passed: true,
        });

        await open('order=RETRY&retry-mode=verified-external');
        await page.getByRole('button', { name: '重试原退款', exact: true }).click();
        await page
            .getByRole('dialog', { name: '确认资金操作', exact: true })
            .getByLabel('当前管理员密码', { exact: true })
            .fill('synthetic-confirmation-no-credential');
        await page
            .getByRole('dialog', { name: '确认资金操作', exact: true })
            .getByRole('button', { name: '验证并执行', exact: true })
            .click();
        await expect(page.getByRole('link', { name: '进入专用退款核验', exact: true })).toHaveAttribute(
            'href',
            '/settings/usdt-payments',
        );
        await expect(page.getByRole('button', { name: '登记人工退款凭证', exact: true })).toHaveCount(0);
        expect((await writes()).map(item => item.operation)).toEqual(['NextAdminRetryRefund']);
        results.push({
            scenario:
                'verified external refund retries original record then requires dedicated verification without manual settle',
            passed: true,
        });

        await open('order=RETRY&retry-known-failure');
        for (let attempt = 0; attempt < 2; attempt++) {
            await page.getByRole('button', { name: '重试原退款', exact: true }).click();
            const dialog = page.getByRole('dialog', { name: '确认资金操作', exact: true });
            await dialog
                .getByLabel('当前管理员密码', { exact: true })
                .fill('synthetic-confirmation-no-credential');
            await dialog.getByRole('button', { name: '验证并执行', exact: true }).click();
            await expect(dialog).toHaveCount(0);
            if (attempt === 0)
                await expect(
                    page.getByRole('alert').filter({ hasText: '原退款重试结果：退款失败' }),
                ).toBeVisible();
        }
        const knownRetryWrites = await writes();
        expect(knownRetryWrites).toHaveLength(2);
        expect(knownRetryWrites.map(item => item.input.refundId)).toEqual([
            'fixture-failed-refund',
            'fixture-failed-refund',
        ]);
        expect(knownRetryWrites[0].input.idempotencyKey).not.toBe(knownRetryWrites[1].input.idempotencyKey);
        await expect(page.getByRole('button', { name: '登记人工退款凭证', exact: true })).toBeVisible();
        results.push({
            scenario:
                'a known failed retry remains an error; the next deliberate attempt gets a new key for the same original refund',
            passed: true,
        });

        await open('order=PHYSICAL&dispatch-failure');
        await page
            .getByRole('region', { name: '订单处理进度' })
            .getByRole('button', { name: '发出已有包裹', exact: true })
            .click();
        const shipment = page.getByRole('dialog', { name: '发出已有包裹' });
        await expect(shipment).toBeVisible();
        await shipment.locator('input').nth(0).fill('合成承运商');
        await shipment.locator('input').nth(1).fill('SYNTHETIC-NO-SHIPMENT-001');
        await shipment.getByRole('button', { name: '确认包裹已发出', exact: true }).click();
        await expect(shipment).toBeVisible();
        await expect(shipment.locator('input').nth(1)).toHaveValue('SYNTHETIC-NO-SHIPMENT-001');
        await capture('existing-package-retry-desktop');
        await shipment.getByRole('button', { name: '确认包裹已发出', exact: true }).click();
        await expect(shipment).toHaveCount(0);
        const shipmentWrites = await writes();
        expect(
            shipmentWrites.filter(item => item.operation === 'NextAdminPrepareFulfillmentShipment'),
        ).toHaveLength(2);
        expect(
            shipmentWrites
                .filter(item => item.operation === 'TransitionSalesFulfillment')
                .map(item => item.input.id),
        ).toEqual(['fixture-package', 'fixture-package', 'fixture-package']);
        expect(
            shipmentWrites
                .filter(item => item.operation === 'TransitionSalesFulfillment')
                .map(item => item.input),
        ).toEqual([
            { id: 'fixture-package', state: 'Pending' },
            { id: 'fixture-package', state: 'Shipped' },
            { id: 'fixture-package', state: 'Shipped' },
        ]);
        expect(shipmentWrites.filter(item => item.operation === 'AddSalesOrderFulfillment')).toEqual([]);
        results.push({
            scenario:
                'created package accepts logistics then retries dispatch on the same package without replacement',
            passed: true,
        });

        await open('order=MODIFY&modify&finish-failure');
        await page.getByRole('button', { name: '增加实物商品（合成商品）数量', exact: true }).click();
        await page.getByPlaceholder('说明客户诉求、客服工单或修改依据').fill('合成修改验收');
        await page.getByRole('button', { name: '预览修改结果', exact: true }).click();
        await page.getByRole('button', { name: '保存并结束修改', exact: true }).click();
        await page.getByRole('alertdialog').getByRole('button', { name: '写入修改', exact: true }).click();
        await expect(page.getByText(/修改已写入，但尚未结束修改状态/)).toBeVisible();
        await capture('modification-finish-failure-desktop');
        await page.getByRole('button', { name: '重试结束修改', exact: true }).click();
        await expect(page.getByRole('region', { name: '订单处理进度' })).toBeVisible();
        const modificationWrites = await writes();
        expect(modificationWrites.filter(item => item.operation === 'ModifySalesOrder')).toHaveLength(1);
        expect(modificationWrites.filter(item => item.operation === 'FinishOrderModification')).toHaveLength(
            2,
        );
        results.push({
            scenario: 'saved modification with failed finish retries only finish, never replays modification',
            passed: true,
        });

        await page.setViewportSize({ width: 390, height: 844 });
        for (const [query, name] of [
            ['list', 'orders-mobile'],
            ['order=DIGITAL', 'digital-mobile'],
            ['order=CANCELLED', 'cancelled-mobile'],
            ['order=PHYSICAL', 'physical-mobile'],
            ['order=MODIFY&modify', 'modification-mobile'],
        ]) {
            await open(query);
            await expect(
                page
                    .getByRole('main')
                    .or(page.getByRole('heading', { name: '订单处理台' }))
                    .first(),
            ).toBeVisible();
            const widths = await overflow();
            expect(widths.document).toBeLessThanOrEqual(widths.viewport);
            await capture(name);
            results.push({
                scenario: name + ' has no document horizontal overflow',
                passed: true,
                ...widths,
            });
        }
        await open('order=DIGITAL');
        await page
            .getByRole('region', { name: '订单处理进度' })
            .getByRole('button', { name: '准备交付', exact: true })
            .click();
        await expect(page.getByRole('region', { name: '交付任务详情', exact: true })).toBeInViewport();
        await capture('digital-editor-mobile');
        const mobileTaskWidths = await overflow();
        expect(mobileTaskWidths.document).toBeLessThanOrEqual(mobileTaskWidths.viewport);
        results.push({
            scenario: 'mobile main delivery action brings the bound task editor into the viewport',
            passed: true,
            ...mobileTaskWidths,
        });
        const close = page
            .getByRole('region', { name: '交付任务详情', exact: true })
            .getByRole('button', { name: '关闭', exact: true });
        expect(await close.evaluate(element => getComputedStyle(element).whiteSpace)).toBe('nowrap');
        await open('order=DIGITAL&batch');
        await page
            .getByRole('region', { name: '订单处理进度' })
            .getByRole('button', { name: '准备交付', exact: true })
            .click();
        await page
            .getByLabel('批量成品 TSV', { exact: true })
            .fill('SYNTHETIC-A\tdummy-a-no-credential\t第一件\nSYNTHETIC-B\t\t第二件\n\t\t第三件仅说明');
        await page.getByRole('button', { name: '校验并预览', exact: true }).click();
        await expect(page.getByRole('button', { name: '应用到草稿', exact: true })).toBeEnabled();
        const mobileBatchWidths = await overflow();
        expect(mobileBatchWidths.document).toBeLessThanOrEqual(mobileBatchWidths.viewport);
        await capture('digital-batch-preview-mobile');
        await page.getByRole('button', { name: '应用到草稿', exact: true }).click();
        await expect(page.getByLabel('成品包 3 交付说明', { exact: true })).toHaveValue('第三件仅说明');
        expect(await writes()).toEqual([]);
        results.push({
            scenario:
                'mobile batch preview and explicit application fit 390px; task close label remains one line',
            passed: true,
            ...mobileBatchWidths,
        });
    }
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
    await writeFile(
        path.join(output, manualIncremental ? 'manual-incremental-results.json' : 'results.json'),
        JSON.stringify(
            {
                passed: true,
                source: 'formal SalesModule/OrderEditor/ModifyOrderEditor with synthetic in-memory Apollo transport',
                productionConnection: false,
                realFunds: 'NOT_MEASURED',
                smtpDelivery: 'NOT_MEASURED',
                customerClaim: 'NOT_MEASURED',
                results,
                pageErrors,
                externalRequests,
            },
            null,
            2,
        ),
    );
    console.log('Formal order pages synthetic browser acceptance passed: ' + results.length + ' scenarios');
} catch (error) {
    await writeFile(
        path.join(output, 'failure.json'),
        JSON.stringify(
            {
                error: String(error),
                pageErrors,
                externalRequests,
                completed: results,
                text: await page.locator('body').innerText(),
            },
            null,
            2,
        ),
    );
    await capture('failure');
    throw error;
} finally {
    await browser.close();
}
