// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { QuantityControl } from './quantity-control';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const change = vi.fn();
const increase = vi.fn();
const decrease = vi.fn();
beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
});
function render(props: Partial<Parameters<typeof QuantityControl>[0]> = {}) {
    act(() =>
        root.render(
            <QuantityControl
                value={6}
                label="购买数量"
                decreaseLabel="减少"
                increaseLabel="增加"
                onChange={change}
                onDecrease={decrease}
                onIncrease={increase}
                max={12}
                {...props}
            />,
        ),
    );
}
function fill(value: string) {
    const input = container.querySelector('input');
    if (!input) throw new Error('Quantity input is missing');
    act(() => {
        input.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return input;
}

it('keeps typing local and commits once on Enter followed by blur', () => {
    render();
    const input = fill('10');
    expect(change).not.toHaveBeenCalled();
    act(() => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(change).toHaveBeenCalledExactlyOnceWith(10);
    act(() => input.blur());
    expect(change).toHaveBeenCalledTimes(1);
    render({ value: 10 });
    expect(input.value).toBe('10');
});

it.each(['', 'abc', '-2', '2.5', '1e3', '9007199254740992'])(
    'restores the confirmed quantity for invalid input %j',
    text => {
        render();
        const input = fill(text);
        act(() => input.blur());
        expect(input.value).toBe('6');
        expect(change).not.toHaveBeenCalled();
        expect(decrease).not.toHaveBeenCalled();
    },
);

it.each([
    ['0', 1],
    ['999', 12],
    ['008', 8],
])('normalizes %s to %s without removing the item', (text, expected) => {
    render();
    const input = fill(String(text));
    act(() => input.blur());
    expect(change).toHaveBeenCalledExactlyOnceWith(expected);
    expect(decrease).not.toHaveBeenCalled();
});

it('cancels edits with Escape and ignores unchanged values', () => {
    render();
    const input = fill('11');
    act(() => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(input.value).toBe('6');
    act(() => fill('6').blur());
    expect(change).not.toHaveBeenCalled();
});

it.each([
    ['button:first-child', 9],
    ['button:last-child', 11],
])('steps from the entered draft using %s without duplicate writes', (selector, expected) => {
    render();
    const input = fill('10');
    const button = container.querySelector<HTMLButtonElement>(selector);
    if (!button) throw new Error('Quantity step button is missing');
    const pointer = new Event('pointerdown', { bubbles: true, cancelable: true });
    act(() => {
        button.dispatchEvent(pointer);
    });
    expect(pointer.defaultPrevented).toBe(true);
    act(() => button.click());
    act(() => input.blur());
    expect(change).toHaveBeenCalledExactlyOnceWith(expected);
    expect(increase).not.toHaveBeenCalled();
    expect(decrease).not.toHaveBeenCalled();
});

it('resets a draft after an external quantity change and disables input while busy', () => {
    render();
    const input = fill('10');
    render({ value: 2 });
    expect(input.value).toBe('2');
    act(() => input.blur());
    expect(change).not.toHaveBeenCalled();
    fill('4');
    render({ value: 2, inputDisabled: true, decreaseDisabled: true, increaseDisabled: true });
    expect(input.disabled).toBe(true);
    expect(input.value).toBe('2');
    expect([...container.querySelectorAll('button')].every(button => button.disabled)).toBe(true);
});

it('preserves existing step and removal callbacks when no draft is being edited', () => {
    render({ value: 1 });
    const decreaseButton = container.querySelector<HTMLButtonElement>('button:first-child');
    if (!decreaseButton) throw new Error('Quantity step button is missing');
    act(() => decreaseButton.click());
    expect(decrease).toHaveBeenCalledOnce();
    expect(change).not.toHaveBeenCalled();
    render({ onChange: undefined });
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('output')?.textContent).toBe('6');
    const increaseButton = container.querySelector<HTMLButtonElement>('button:last-child');
    if (!increaseButton) throw new Error('Quantity step button is missing');
    act(() => increaseButton.click());
    expect(increase).toHaveBeenCalledOnce();
});
