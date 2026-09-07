import { describe, expect, it } from 'vitest';

import { isInputMethodKey } from './input-method';

describe('input method keyboard ownership', () => {
    it.each([
        [{ isComposing: true, keyCode: 13 }, true],
        [{ isComposing: true, keyCode: 27 }, true],
        [{ isComposing: true, keyCode: 40 }, true],
        [{ isComposing: false, keyCode: 229 }, true],
        [{ isComposing: false, keyCode: 13 }, false],
        [{ isComposing: false, keyCode: 27 }, false],
        [{ isComposing: false, keyCode: 40 }, false],
        [{}, false],
    ])('recognizes %j as IME=%s', (event, expected) => {
        expect(isInputMethodKey(event)).toBe(expected);
    });
});
