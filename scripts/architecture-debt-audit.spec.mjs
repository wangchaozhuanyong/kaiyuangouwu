import assert from 'node:assert/strict';
import test from 'node:test';

import { countLines, evaluateLimit } from './architecture-debt-audit.mjs';

test('counts empty, terminated, and unterminated sources consistently', () => {
    assert.equal(countLines(''), 0);
    assert.equal(countLines('one\n'), 1);
    assert.equal(countLines('one\ntwo'), 2);
    assert.equal(countLines('one\r\ntwo\r\n'), 2);
});

test('marks only growth beyond the recorded baseline as over budget', () => {
    assert.equal(
        evaluateLimit({ id: 'same', currentLines: 10, maxLines: 10, targetLines: 5 }).overBudget,
        false,
    );
    assert.equal(
        evaluateLimit({ id: 'smaller', currentLines: 9, maxLines: 10, targetLines: 5 }).overBudget,
        false,
    );
    assert.equal(
        evaluateLimit({ id: 'larger', currentLines: 11, maxLines: 10, targetLines: 5 }).overBudget,
        true,
    );
});
