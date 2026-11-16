import assert from 'node:assert/strict';
import { expect, it } from 'vitest';

import { birthCountry, birthRectangle } from './birthplace';

it.each([
    ['SICHUAN', 'CHN'],
    ['GUANGDONG', 'CHN'],
    ['INNER MONGOLIA', 'CHN'],
    ['USA', 'USA'],
    ['MALAYSIA', 'MYS'],
    ['SINGAPORE', 'SGP'],
    ['HONG KONG', 'HKG'],
    ['MACAU', 'MAC'],
    ['TAIWAN', 'TWN'],
])('maps the explicit birth value %s to the official option %s', (place, code) => {
    expect(birthCountry(place, 95)).toBe(code);
});

it('abstains on low confidence, ambiguous places, unrelated text and country mixtures', () => {
    expect(birthCountry('SICHUAN', 40)).toBeUndefined();
    for (const text of [
        'GEORGIA',
        'SICHU4N',
        'SICHUAN USA',
        'CHINESE',
        'Place of issue SICHUAN',
        '',
        'UNKNOWN',
        'LONDON',
    ]) {
        expect(birthCountry(text, 95)).toBeUndefined();
    }
});

const label = (kind: string, y = 10, confidence = 95) => [
    { text: 'Place', confidence, bbox: { x0: 100, y0: y, x1: 140, y1: y + 10 } },
    { text: 'of', confidence, bbox: { x0: 145, y0: y, x1: 160, y1: y + 10 } },
    { text: kind, confidence, bbox: { x0: 165, y0: y, x1: 200, y1: y + 10 } },
];

it('crops below the birth label and stops before the issue label', () => {
    const rectangle = birthRectangle([...label('birth'), ...label('issue', 45)], 600, 400, 'CHN');
    assert.ok(rectangle);
    expect(rectangle.top).toBeGreaterThanOrEqual(20);
    expect(rectangle.top + rectangle.height).toBeLessThan(45);
    expect(birthRectangle(label('issue'), 600, 400, 'CHN')).toBeUndefined();
});

it('requires the known two-label layout for a partially read Chinese birth label', () => {
    expect(birthRectangle(label('ben'), 600, 400, 'CHN')).toBeUndefined();
    expect(birthRectangle([...label('ben'), ...label('issue', 50)], 600, 400, 'USA')).toBeUndefined();
    expect(birthRectangle([...label('ben'), ...label('issue', 50)], 600, 400, 'CHN')).toBeDefined();
    expect(birthRectangle([...label('business'), ...label('issue', 50)], 600, 400, 'CHN')).toBeUndefined();
});

it('does not choose between conflicting or low-confidence birth labels', () => {
    expect(birthRectangle([...label('birth'), ...label('birth', 60)], 600, 400, 'CHN')).toBeUndefined();
    expect(birthRectangle(label('birth', 10, 20), 600, 400, 'CHN')).toBeUndefined();
});
