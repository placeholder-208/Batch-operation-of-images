import test from 'node:test';
import assert from 'node:assert/strict';
import { measure, truthBox } from './metrics.mjs';
test('identical masks: perfect geometry, zero alpha error', () => {
    const m = [0, 1, 0, 0, .75, 0, 0, 0, 0], r = measure(m, m, 3, 3);
    assert.equal(r.iou, 1); assert.equal(r.boundaryF1, 1); assert.equal(r.alphaMAE, 0);
});
test('missing an internal hole reduces boundary recall', () => {
    const t = new Float32Array(81).fill(1), p = t.slice(); t[40] = 0;
    const r = measure(p, t, 9, 9, 0); assert.equal(r.iou, 80 / 81); assert.ok(r.boundaryRecall < 1);
});
test('boundary tolerance uses Euclidean pixel distance', () => {
    const a = new Float32Array(49), b = a.slice(); a[16] = 1; b[18] = 1;
    assert.equal(measure(a, b, 7, 7, 2).boundaryF1, 1);
    assert.equal(measure(a, b, 7, 7, 1).boundaryF1, 0);
    b[18] = 0; b[32] = 1; assert.equal(measure(a, b, 7, 7, 2).boundaryF1, 0);
});
test('empty predictions are not dropped from scores', () => {
    const r = measure([0, 0], [1, 0], 2, 1); assert.equal(r.iou, 0); assert.equal(r.boundaryF1, 0); assert.equal(r.alphaMAE, .5);
});
test('invalid dimensions and alpha values fail explicitly', () => {
    assert.equal(measure([0], [0], 1, 1).iou, 1);
    assert.throws(() => measure([NaN], [0], 1, 1)); assert.throws(() => measure([2], [0], 1, 1)); assert.throws(() => measure([], [0], 1, 1));
});
test('truth box includes antialiased extent and rejects empty truth', () => {
    assert.deepEqual(truthBox([0, .1, 0, 0, 1, 0], 3, 2), [1, 0, 2, 2]); assert.throws(() => truthBox([0], 1, 1));
});
