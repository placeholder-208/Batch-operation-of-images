import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeAlphaBilinear, alphaToRgba } from './alpha.mjs';

function close(actual, expected, tolerance = 1e-7) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test('constant alpha remains constant when upsampling, downsampling or stretching', () => {
    for (const value of [0, .001, .37, 1]) {
        for (const [sw, sh, dw, dh] of [[2, 3, 7, 9], [7, 9, 2, 3], [1, 1, 5, 3]]) {
            const alpha = resizeAlphaBilinear(new Float32Array(sw * sh).fill(value), sw, sh, dw, dh);
            assert.ok(alpha instanceof Float32Array);
            assert.equal(alpha.length, dw * dh);
            for (const sample of alpha) close(sample, value);
        }
    }
});

test('two-by-two upsampling uses centre alignment and clamped edges', () => {
    const actual = resizeAlphaBilinear([0, 1, 1, 0], 2, 2, 4, 4);
    const expected = [0, .25, .75, 1, .25, .375, .625, .75, .75, .625, .375, .25, 1, .75, .25, 0];
    assert.deepEqual([...actual], expected);
});

test('downsampling samples the source centre without binary thresholding', () => {
    assert.deepEqual([...resizeAlphaBilinear([0, 1, 1, 0], 2, 2, 1, 1)], [.5]);
    const actual = resizeAlphaBilinear([0, .5, 1], 3, 1, 5, 1);
    [0, .2, .5, .8, 1].forEach((value, i) => close(actual[i], value));
});

test('identity resize returns an independent Float32Array and preserves input', () => {
    const source = new Float32Array([0, .25, .75, 1]), result = resizeAlphaBilinear(source, 2, 2, 2, 2);
    assert.notEqual(result, source);
    assert.deepEqual(result, source);
    result[0] = 1;
    assert.equal(source[0], 0);
});

test('alpha below one byte of coverage remains nonzero for scoring', () => {
    const source = new Float32Array([0, .001]);
    const result = resizeAlphaBilinear(source, 2, 1, 4, 1);
    close(result[1], .00025, 1e-10);
    close(result[2], .00075, 1e-10);
    close(result[3], .001, 1e-10);
    assert.ok(result[1] > 0 && result[3] < 1 / 255);
    assert.deepEqual(source, new Float32Array([0, .001]));
});

test('preview converts alpha to rounded opaque grayscale without changing alpha', () => {
    const source = [0, .001, .5, 1], rgba = alphaToRgba(source, 2, 2);
    assert.ok(rgba instanceof Uint8ClampedArray);
    assert.deepEqual([...rgba], [0, 0, 0, 255, 0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
    assert.deepEqual(source, [0, .001, .5, 1]);
});

test('invalid source and destination dimensions fail before resizing', () => {
    const invalid = [[0, 1], [1, 0], [-1, 1], [1, -.5], [1.5, 1], [1, NaN], [Infinity, 1], ['1', 1], [Number.MAX_SAFE_INTEGER, 2]];
    for (const [width, height] of invalid) {
        assert.throws(() => resizeAlphaBilinear([0], width, height, 1, 1));
        assert.throws(() => resizeAlphaBilinear([0], 1, 1, width, height));
        assert.throws(() => alphaToRgba([0], width, height));
    }
});

test('invalid lengths, nonfinite alpha and values outside unit range are rejected', () => {
    for (const source of [null, undefined, [], [0, 1], [NaN], [Infinity], [-Infinity], [-.001], [1.001], ['0'], new Array(1)]) {
        assert.throws(() => resizeAlphaBilinear(source, 1, 1, 2, 2));
        assert.throws(() => alphaToRgba(source, 1, 1));
    }
});
