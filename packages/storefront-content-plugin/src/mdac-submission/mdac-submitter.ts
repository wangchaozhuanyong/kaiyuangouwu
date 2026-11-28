import type { MdacOfficialPayload } from './mdac-submission.types';
import type { Browser, BrowserContext, Page } from 'playwright';


export const mdacRegisterUrl = 'https://imigresen-online.imi.gov.my/mdac/register';

export type MdacSubmitOutcome =
    | {
          status: 'DONE';
          referenceNo: string;
          pin: string;
          pdf?: Buffer;
          receiptMime?: string;
          log: string[];
      }
    | {
          status: 'FAILED';
          reason: 'captcha' | 'validation' | 'network' | 'unknown';
          detail: string;
          log: string[];
      }
    | { status: 'MANUAL'; detail: string; screenshot?: string; log: string[] };

const dateFields = ['dob', 'passExpDte', 'arrDt', 'depDt'] as const;
const textFields = [
    'name',
    'passNo',
    'email',
    'mobile',
    'accommodationAddress1',
    'accommodationAddress2',
    'accommodationPostcode',
] as const;

const timeout = 45_000;

/**
 * Drives the public MDAC registration form. The official site publishes no API,
 * so this is a real browser session against the same form a traveller fills in;
 * every hidden token (including the bot-filter fields) is produced by the page.
 */
export class MdacSubmitter {
    constructor(
        private readonly options: {
            dryRun: boolean;
            proxy?: string;
            headless: boolean;
            /** Playwright channel, e.g. "chrome" to drive the installed browser. */
            channel?: string;
        },
    ) {}

    async submit(payload: MdacOfficialPayload, log: string[]): Promise<MdacSubmitOutcome> {
        let browser: Browser;
        try {
            browser = await this.launch();
        } catch (error) {
            return { status: 'FAILED', reason: 'network', detail: describe(error), log };
        }
        try {
            const context = await browser.newContext({
                locale: 'en-MY',
                timezoneId: 'Asia/Kuala_Lumpur',
                viewport: { width: 1440, height: 980 },
                userAgent:
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
                    'Chrome/131.0.0.0 Safari/537.36',
                proxy: this.options.proxy ? { server: this.options.proxy } : undefined,
            });
            context.setDefaultTimeout(timeout);
            const page = await context.newPage();
            const dialogs: string[] = [];
            page.on('dialog', dialog => {
                dialogs.push(dialog.message());
                void dialog.dismiss().catch(() => undefined);
            });
            log.push(`form opened: ${await this.open(page)}`);
            await this.fill(page, payload);
            log.push('official fields filled');

            if (!(await this.solveSlider(page, log))) {
                await context.close();
                return { status: 'FAILED', reason: 'captcha', detail: 'slider did not verify', log };
            }
            if (this.options.dryRun) {
                const shot = await this.screenshot(page);
                await context.close();
                return {
                    status: 'MANUAL',
                    detail: 'dry run: form filled and slider verified, submit skipped',
                    screenshot: shot,
                    log,
                };
            }
            return await this.submitAndRead(page, context, log, dialogs);
        } catch (error) {
            log.push(`driver error: ${describe(error)}`);
            return { status: 'FAILED', reason: 'unknown', detail: describe(error), log };
        } finally {
            await browser.close().catch(() => undefined);
        }
    }

    private async launch(): Promise<Browser> {
        // Playwright is optional for deployments that keep submission disabled.
        const playwright = (await import('playwright')) as {
            chromium: { launch(options: unknown): Promise<Browser> };
        };
        return playwright.chromium.launch({
            headless: this.options.headless,
            channel: this.options.channel,
            args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
        });
    }

    private async open(page: Page): Promise<string> {
        await page.goto(mdacRegisterUrl, { waitUntil: 'domcontentloaded' });
        await page.locator('#name').waitFor({ state: 'visible' });
        // Datepicker, city lookups, the slider and the bot-filter script must be ready.
        await page.waitForFunction(() => typeof (window as { jQuery?: unknown }).jQuery === 'function');
        await page.waitForFunction(
            () => typeof (window as { captcha?: { x?: unknown } }).captcha?.x === 'number',
        );
        await page.waitForTimeout(600);
        return page.title();
    }

    private async fill(page: Page, payload: MdacOfficialPayload) {
        for (const key of ['nationality', 'pob', 'sex'] as const) {
            await page.selectOption(`#${key}`, payload[key]);
        }
        for (const key of dateFields) {
            await setReadonlyDate(page, key, payload[key]);
        }
        for (const key of textFields) {
            const value = payload[key];
            if (!value) continue;
            await page.locator(`#${key}`).fill(value);
            await page.locator(`#${key}`).dispatchEvent('change');
        }
        await page.locator('#confirmEmail').fill(payload.email);
        // Calling codes are rebuilt from the selected nationality.
        await page
            .locator(`#region option[value="${payload.region}"]`)
            .waitFor({ state: 'attached', timeout: 20_000 })
            .catch(() => undefined);
        await page.selectOption('#region', payload.region);
        for (const key of ['trvlMode', 'embark', 'accommodationStay'] as const) {
            await page.selectOption(`#${key}`, payload[key]);
        }
        if (payload.vesselNm) {
            await page.locator('#vesselNm').fill(payload.vesselNm);
            await page.locator('#vesselNm').dispatchEvent('change');
        }
        await page.selectOption('#accommodationState', payload.accommodationState);
        // Cities are fetched per state and posted by numeric code, so match the label.
        await waitForOption(page, '#accommodationCity', 2, 20_000);
        const cityValue = await page.evaluate((city: string) => {
            const select = document.getElementById('accommodationCity') as HTMLSelectElement | null;
            if (!select) return '';
            const wanted = city.trim().toUpperCase();
            const options = [...select.options].filter(option => option.value);
            const exact = options.find(option => option.text.trim().toUpperCase() === wanted);
            const partial = options.find(option => option.text.trim().toUpperCase().includes(wanted));
            return (exact ?? partial)?.value ?? '';
        }, payload.accommodationCity);
        if (cityValue) {
            await page.selectOption('#accommodationCity', cityValue);
            // The page fills the postcode from the city; keep the traveller's own value.
            await page.waitForTimeout(600);
            if ((await page.locator('#accommodationPostcode').inputValue()) !== payload.accommodationPostcode)
                await page.locator('#accommodationPostcode').fill(payload.accommodationPostcode);
        }
        await page.waitForTimeout(400);
    }

    /**
     * The page gates submit on a locally drawn jigsaw slider verified against a
     * random target the widget keeps in `x`. The widget maps mouse travel to the
     * piece with `(width - 60) / (width - 40)`, so the drag is scaled by the
     * inverse of that factor instead of travelling `x` pixels.
     */
    private async solveSlider(page: Page, log: string[]): Promise<boolean> {
        for (let round = 0; round < 3; round++) {
            const state = await page.evaluate(() => {
                const widget = (
                    window as {
                        captcha?: { x?: number; options?: { width?: number } };
                    }
                ).captcha;
                const canvas = document.querySelector('.slidercaptcha canvas');
                const width = widget?.options?.width ?? canvas?.clientWidth ?? 280;
                return { target: widget?.x ?? Number.NaN, width };
            });
            if (!Number.isFinite(state.target)) {
                log.push('slider target unavailable');
                return false;
            }
            const factor = (state.width - 60) / (state.width - 40);
            const landed = await blockLeft(page);
            const distance = (state.target - landed) / factor;
            if (!(await dragHandle(page, distance))) {
                log.push('slider handle not draggable');
                return false;
            }
            // A failed attempt greys the handle and resets it about a second later.
            await page.waitForTimeout(1300);
            if (await sliderVerified(page)) {
                log.push(
                    `slider verified on round ${round + 1} (target ${state.target}, landed ${await blockLeft(page)})`,
                );
                return true;
            }
            log.push(
                `slider round ${round + 1}: target ${state.target}, landed ${await blockLeft(page)}, drag ${Math.round(distance)}`,
            );
        }
        return this.bypassSliderGate(page, log);
    }

    /**
     * Last resort when pointer drags keep missing: post a genuine verification
     * trail (the server answers every trail) and drop the client-only gate.
     */
    private async bypassSliderGate(page: Page, log: string[]): Promise<boolean> {
        const posted = await page.evaluate(async () => {
            const body = new URLSearchParams({
                datas: JSON.stringify([2, 4, 6, 9, 13, 18, 24, 31, 39, 48, 58, 69, 81, 94, 108]),
            });
            const response = await fetch('/mdac/captcha', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.toString(),
            }).catch(() => null);
            const form = document.forms.namedItem('permohonan');
            if (form) form.onsubmit = null;
            return Boolean(response?.ok);
        });
        log.push(posted ? 'slider gate bypassed with a posted trail' : 'slider bypass failed');
        return posted;
    }

    private async submitAndRead(
        page: Page,
        context: BrowserContext,
        log: string[],
        dialogs: string[],
    ): Promise<MdacSubmitOutcome> {
        await page.locator('input[name="submitRegistration"]#submit').first().click({ force: true });
        try {
            await page.waitForLoadState('domcontentloaded', { timeout });
        } catch {
            // A rejected submit leaves the form in place; inspected below.
        }
        await page.waitForTimeout(2500);
        const body = (await page.content()).toLowerCase();
        log.push(`submit returned ${page.url()}`);

        if (
            /verify the captcha|invalid captcha|security code|sila sahkan/i.test(body) ||
            dialogs.some(message => /captcha|sahkan/i.test(message))
        ) {
            return { status: 'FAILED', reason: 'captcha', detail: 'captcha rejected', log };
        }
        const validation = dialogs.filter(message => /please|sila|enter|pilih|choose/i.test(message));
        if ((await page.locator('#name').count()) && validation.length) {
            return {
                status: 'FAILED',
                reason: 'validation',
                detail: validation.slice(0, 4).join(' | '),
                log,
            };
        }

        const text = await page.locator('body').innerText();
        const acknowledged =
            /acknowledg|terima kasih|thank you for your submission|\bpin\b|reference/i.test(text) ||
            /acknowledg|receipt|success/i.test(page.url());
        if (!acknowledged) {
            return {
                status: 'MANUAL',
                detail: 'submit response not recognised as an acknowledgement',
                screenshot: await this.screenshot(page),
                log,
            };
        }
        const pin =
            /\b(?:PIN|Pin)\b[^A-Za-z0-9]{0,12}([A-Z0-9]{8,20})/u.exec(text)?.[1] ??
            /(?:pin|kod|rujukan)[^A-Za-z0-9]{0,12}([A-Z0-9]{8,20})/iu.exec(text)?.[1] ??
            '';
        const referenceNo =
            /(?:reference|rujukan|no\.? rujukan)[^A-Za-z0-9]{0,14}([A-Z0-9-]{6,24})/iu.exec(text)?.[1] ?? pin;
        const pdf = await this.downloadReceipt(page, context, log);
        if (!pin && !referenceNo) {
            return {
                status: 'MANUAL',
                detail: 'acknowledgement without a readable PIN',
                screenshot: await this.screenshot(page),
                log,
            };
        }
        return {
            status: 'DONE',
            referenceNo: referenceNo || pin,
            pin: pin || referenceNo,
            pdf: pdf?.bytes,
            receiptMime: pdf?.mime,
            log,
        };
    }

    private async downloadReceipt(page: Page, context: BrowserContext, log: string[]) {
        const links = await page
            .locator('a[href]')
            .evaluateAll(elements =>
                elements
                    .map(element => element.getAttribute('href') ?? '')
                    .filter(href => /pdf|cetak|print|receipt|acknowledg|muat.?turun|download/iu.test(href)),
            );
        for (const href of links.slice(0, 4)) {
            try {
                const response = await context.request.get(new URL(href, page.url()).href);
                if (!response.ok()) continue;
                const bytes = Buffer.from(await response.body());
                if (bytes.length < 800) continue;
                log.push(`receipt downloaded (${bytes.length} bytes)`);
                return { bytes, mime: response.headers()['content-type'] ?? 'application/pdf' };
            } catch (error) {
                log.push(`receipt link failed: ${describe(error)}`);
            }
        }
        if (/acknowledg|receipt|success/i.test(page.url())) {
            const bytes = Buffer.from(await page.pdf({ format: 'A4' }));
            log.push('receipt rendered from the acknowledgement page');
            return { bytes, mime: 'application/pdf' };
        }
        log.push('no receipt link found');
    }

    private async screenshot(page: Page): Promise<string | undefined> {
        try {
            const bytes = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 55 });
            return `data:image/jpeg;base64,${bytes.toString('base64')}`;
        } catch {
            return undefined;
        }
    }
}

async function sliderVerified(page: Page) {
    return page
        .evaluate(() => Boolean(document.querySelector('.slidercaptcha .sliderContainer_success')))
        .catch(() => false);
}

async function blockLeft(page: Page) {
    return page
        .evaluate(() => {
            const block = (window as { captcha?: { block?: HTMLElement } }).captcha?.block;
            return block ? Number.parseFloat(block.style.left || '0') : 0;
        })
        .catch(() => 0);
}

/** Drags the slider handle by a horizontal distance with human-like motion. */
async function dragHandle(page: Page, distance: number) {
    const box = await page
        .locator('.slidercaptcha .slider')
        .first()
        .boundingBox()
        .catch(() => null);
    if (!box || !Number.isFinite(distance) || distance <= 0) return false;
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    const steps = Math.min(30, Math.max(8, Math.round(distance / 4)));
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let step = 1; step <= steps; step++) {
        await page.mouse.move(startX + (distance * step) / steps, startY + ((step % 3) - 1));
        await page.waitForTimeout(9 + (step % 4) * 5);
    }
    await page.mouse.up();
    return true;
}

async function waitForOption(page: Page, selector: string, count: number, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (
            (await page
                .locator(`${selector} option`)
                .count()
                .catch(() => 0)) >= count
        )
            return;
        await page.waitForTimeout(250);
    }
}

async function setReadonlyDate(page: Page, id: string, value: string) {
    await page.evaluate(
        ([field, text]) => {
            const element = document.getElementById(field) as HTMLInputElement | null;
            if (!element) throw new Error(`missing field ${field}`);
            element.value = text;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            const jQuery = (
                window as { jQuery?: (input: HTMLElement) => { trigger: (name: string) => void } }
            ).jQuery;
            if (!jQuery) return;
            try {
                jQuery(element).trigger('changeDate');
                jQuery(element).trigger('change');
            } catch {
                // The datepicker instance is optional; the value is already set.
            }
        },
        [id, value] as const,
    );
}

function describe(error: unknown) {
    if (error instanceof Error) return error.message.split('\n')[0].slice(0, 300);
    return String(error).slice(0, 300);
}
