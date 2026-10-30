import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const destination = process.env.PORTRAIT_RESULTS || '/tmp/xincai-portrait-research/run-' + new Date().toISOString().replace(/[:.]/g, '-');
console.log('Results:', destination);
await mkdir(destination, { recursive: true });
await mkdir(path.join(destination, 'previews'), { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
let timer;
try {
    const page = await browser.newPage();
    page.setDefaultTimeout(600_000);
    const errors = [], failedRequests = [];
    page.on('pageerror', error => { errors.push(error.message); console.log('PAGE ERROR', error.message); });
    page.on('requestfailed', request => failedRequests.push({ url: request.url(), failure: request.failure() }));
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.exposeFunction('writeArtifact', async (name, base64) => {
        if (!/^[\w.-]+\.(png|jpg)$/.test(name)) throw new Error('Invalid artifact name');
        await writeFile(path.join(destination, 'previews', name), Buffer.from(base64, 'base64'));
    });
    await page.exposeFunction('recordProgress', row => {
        console.log(`${row.variant} ${row.sample} IoU=${row.iou.toFixed(4)} edgeMAE=${row.edgeBandMAE?.toFixed(4)} ms=${row.inferencePipelineMs.toFixed(0)}`);
    });
    await page.goto(process.env.PORTRAIT_URL || 'http://127.0.0.1:8771/benchmarks/segmentation/portrait/');
    await page.waitForFunction(() => typeof window.runPortraitBenchmark === 'function');
    timer = setInterval(async () => { try { console.log(await page.locator('#status').innerText()); } catch {} }, 20_000);
    const options = { repeats: Number(process.env.PORTRAIT_REPEATS || 1), promptSet: process.env.PORTRAIT_PROMPTS || 'rgb-boxes' };
    if (process.env.PORTRAIT_VARIANTS) options.variants = process.env.PORTRAIT_VARIANTS.split(',');
    const result = await page.evaluate(options => window.runPortraitBenchmark(options), options);
    result.browserErrors = errors; result.failedRequests = failedRequests;
    await writeFile(path.join(destination, 'results.json'), JSON.stringify(result, null, 2) + '\n');
    const summary = Object.fromEntries(result.variants.map(v => {
        const rows = result.rows.filter(r => r.variant === v.id && r.status === 'ok');
        const mean = key => { const values = rows.map(r => r[key]).filter(Number.isFinite); return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; };
        return [v.id, { count: rows.length, status: v.status, loadMs: v.loadMs, error: v.error,
            ...Object.fromEntries(['iou', 'boundaryF1', 'alphaMAE', 'sad', 'transitionMAE', 'edgeBandMAE', 'coreTransitionMAE', 'geometricEdgeMAE', 'inferencePipelineMs'].map(k => [k, mean(k)])) }];
    }));
    await writeFile(path.join(destination, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log(JSON.stringify(summary, null, 2));
    assert.deepEqual(errors, []);
    assert.equal(result.status, 'complete', JSON.stringify(result.variants));
} finally { clearInterval(timer); await browser.close(); }
