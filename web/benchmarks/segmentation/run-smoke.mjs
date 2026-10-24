// Pass an absolute Playwright module path if it is installed outside this repository.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
let timer;
try {
    const page = await browser.newPage();
    page.setDefaultTimeout(600_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
        const host = new URL(route.request().url()).hostname;
        return host === '127.0.0.1' ? route.continue() : route.abort();
    });
    await page.goto('http://127.0.0.1:8767/benchmarks/segmentation/');
    await page.waitForFunction(() => typeof window.runBenchmark === 'function');
    timer = setInterval(async () => {
        try { process.stdout.write(await page.locator('#status').innerText() + '\n'); } catch {}
    }, 15_000);
    const result = await page.evaluate(() => window.runBenchmark(2));
    await mkdir(new URL('./results/', import.meta.url), { recursive: true });
    await writeFile(new URL('./results/slimsam-smoke.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
    assert.deepEqual(errors, []);
    assert.equal(result.status, 'complete', JSON.stringify(result.variants));
    assert.equal(result.rows.length, 12);
    for (const row of result.rows) {
        assert.equal(row.status, 'ok');
        for (const key of ['iou', 'boundaryF1', 'alphaMAE', 'alphaMSE']) assert.ok(Number.isFinite(row[key]) && row[key] >= 0 && row[key] <= 1);
    }
    const summary = Object.fromEntries(['q8', 'fp32'].map(dtype => {
        const rows = result.rows.filter(row => row.dtype === dtype);
        const average = key => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
        return [dtype, { samples: rows.length, meanIoU: average('iou'), meanBoundaryF1: average('boundaryF1'),
            meanEncodeMs: average('encodeMs'), meanDecodeMs: average('decodeMs') }];
    }));
    console.log(JSON.stringify({ smoke: 'passed', summary }, null, 2));
} finally { clearInterval(timer); await browser.close(); }
