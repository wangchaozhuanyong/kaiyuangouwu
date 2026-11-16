// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
});

it('renders imported names as text and clears textarea fields without invoking a submit', () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
        <form>
            <input type="text" value="sample">
            <textarea>sample</textarea>
            <select id="accommodationState"><option></option><option value="14">KL</option></select>
            <select id="accommodationCity"><option></option><option value="CITY14">KUALA LUMPUR</option></select>
            <input type="hidden" id="sCity">
            <button type="submit">submit</button>
        </form>`;
    const submit = vi.fn();
    const form = document.querySelector('form');
    assert.ok(form);
    form.addEventListener('submit', submit);

    const name = '<img src=x onerror=alert(1)>';
    const script = readFileSync('public/mdac/mdac-autofill.user.js', 'utf8');
    runInNewContext(script, {
        document,
        window,
        Event,
        EventTarget,
        HTMLInputElement,
        HTMLTextAreaElement,
        MutationObserver,
        Option,
        setTimeout,
        clearTimeout,
        GM_getValue: () => ({
            travelers: [{ name, label: 'test' }],
            shared: { accommodation: { state: '14', city: 'KUALA LUMPUR' } },
        }),
        GM_setValue: vi.fn(),
        GM_deleteValue: vi.fn(),
    });
    document.dispatchEvent(new Event('DOMContentLoaded'));
    vi.runOnlyPendingTimers();
    expect(document.querySelector('#mdac-sel')?.textContent).toContain(name);
    expect(document.querySelector('img')).toBeNull();

    const fill = document.querySelector<HTMLButtonElement>('#mdac-fill');
    const clear = document.querySelector<HTMLButtonElement>('#mdac-clear');
    assert.ok(fill && clear);
    fill.click();
    vi.advanceTimersByTime(500);
    expect(document.querySelector<HTMLInputElement>('#sCity')?.value).toBe('CITY14');
    clear.click();
    expect(document.querySelector('textarea')?.value).toBe('');
    expect(submit).not.toHaveBeenCalled();
});
