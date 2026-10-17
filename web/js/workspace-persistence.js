// Local-only storage. Files/Blobs are separate so edits do not rewrite originals.
const DB_NAME = 'xincai-workspace';
const STORES = ['workspaces', 'samMasks', 'assets'];
const assetMarker = '__xincaiAsset';

function requestDone(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('存储事务已中止'));
    });
}
function openDatabase() {
    if (!globalThis.indexedDB) return Promise.reject(new Error('当前浏览器不支持本地工作保存'));
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
        };
        request.onsuccess = () => {
            request.result.onversionchange = () => request.result.close();
            resolve(request.result);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('请关闭本站的其他标签页后重试'));
    });
}
function same(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (a instanceof ArrayBuffer || b instanceof ArrayBuffer) {
        return a instanceof ArrayBuffer && b instanceof ArrayBuffer && a.byteLength === b.byteLength && same(new Uint8Array(a), new Uint8Array(b));
    }
    if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
        if (a.constructor !== b.constructor || a.byteLength !== b.byteLength) return false;
        const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
        return x.every((value, index) => value === y[index]);
    }
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
}

export function createWorkspacePersistence(controllers, onError, onStatus = () => {}) {
    const modes = Object.keys(controllers), pending = new Map(), states = new Map();
    const blocked = new Set(), errors = new Map(), maskRevisions = new Map();
    let database, restoring = true, chain = Promise.resolve(), queued = 0, sequence = 0;
    const getDB = () => database ||= openDatabase();
    const stateFor = mode => {
        if (!states.has(mode)) states.set(mode, { revision: 0, assets: new Set(), ids: new WeakMap(), data: undefined });
        return states.get(mode);
    };
    function status() { onStatus(restoring ? 'restoring' : errors.size ? 'error' : pending.size || queued ? 'saving' : 'saved'); }
    function fail(mode, error) {
        if (!errors.has(mode)) onError(error);
        errors.set(mode, error);status();
    }
    function encode(value, mode, state, assets) {
        if (value instanceof Blob) {
            let id = state.ids.get(value);
            if (!id) { id = mode + '/' + (globalThis.crypto?.randomUUID?.() || Date.now() + '-' + ++sequence); state.ids.set(value, id); }
            assets.set(id, { id, blob: value, name: value.name, lastModified: value.lastModified });
            return { [assetMarker]: id };
        }
        if (!value || typeof value !== 'object' || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
        if (Array.isArray(value)) return value.map(item => encode(item, mode, state, assets));
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item, mode, state, assets)]));
    }
    function decode(value, state, assets) {
        if (!value || typeof value !== 'object' || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
        if (Object.hasOwn(value, assetMarker) && Object.keys(value).length === 1) {
            const asset = assets.get(value[assetMarker]);
            if (!(asset?.blob instanceof Blob)) throw new Error('保存的图片或裁图文件缺失');
            if (!asset.value) asset.value = typeof asset.name === 'string' ? new File([asset.blob], asset.name, { type: asset.blob.type, lastModified: asset.lastModified }) : asset.blob;
            state.ids.set(asset.value, asset.id);
            return asset.value;
        }
        if (Array.isArray(value)) return value.map(item => decode(item, state, assets));
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item, state, assets)]));
    }
    async function write(mode) {
        if (restoring || blocked.has(mode)) return;
        const controller = controllers[mode];
        if (controller.canSnapshot && !controller.canSnapshot()) { schedule(mode, 400);return; }
        const snapshot = await controller.snapshot();
        const state = stateFor(mode), assets = new Map();
        const masks = mode === 'sam' ? snapshot.masks : null;
        const data = encode(mode === 'sam' ? { ...snapshot, masks: undefined } : snapshot, mode, state, assets);
        const masksChanged = masks && (masks.length !== maskRevisions.size || masks.some(entry => maskRevisions.get(entry.id) !== entry.revision));
        if (!masksChanged && same(data, state.data)) { errors.delete(mode);return; }
        // Clone before awaiting I/O: later brush edits must not change this commit.
        const stable = structuredClone(data), db = await getDB();
        const transaction = db.transaction(STORES, 'readwrite'), done = transactionDone(transaction);
        const workspaces = transaction.objectStore('workspaces'), assetStore = transaction.objectStore('assets');
        const check = workspaces.get(mode);
        let conflict = false;
        check.onsuccess = () => {
            if ((check.result?.revision || 0) !== state.revision) { conflict = true;transaction.abort();return; }
            for (const [id, asset] of assets) if (!state.assets.has(id)) assetStore.put(asset, id);
            for (const id of state.assets) if (!assets.has(id)) assetStore.delete(id);
            if (masks) {
                const store = transaction.objectStore('samMasks'), active = new Set(masks.map(entry => entry.id));
                for (const entry of masks) if (maskRevisions.get(entry.id) !== entry.revision) store.put(entry, entry.id);
                for (const id of maskRevisions.keys()) if (!active.has(id)) store.delete(id);
            }
            workspaces.put({ schema: 1, revision: state.revision + 1, data: stable, assets: [...assets.keys()] }, mode);
        };
        try { await done; }
        catch (error) {
            if (conflict) { blocked.add(mode);throw new Error('另一个标签页已修改此工作区。本页未覆盖其内容；请先导出本页修改，再刷新。'); }
            throw error;
        }
        state.revision++;state.assets = new Set(assets.keys());state.data = stable;
        if (masks) { maskRevisions.clear();for (const entry of masks) maskRevisions.set(entry.id, entry.revision); }
        errors.delete(mode);
    }
    function enqueue(mode) {
        pending.delete(mode);queued++;status();
        chain = chain.catch(() => {}).then(() => write(mode)).catch(error => fail(mode, error)).finally(() => { queued--;status(); });
        return chain;
    }
    function schedule(mode, delay = 200) {
        if (restoring || blocked.has(mode) || !controllers[mode]) return;
        clearTimeout(pending.get(mode));
        pending.set(mode, setTimeout(() => enqueue(mode), delay));status();
    }
    async function restore() {
        status();
        try {
            const db = await getDB(), transaction = db.transaction(STORES, 'readonly'), done = transactionDone(transaction);
            const records = modes.map(mode => requestDone(transaction.objectStore('workspaces').get(mode)));
            const masks = requestDone(transaction.objectStore('samMasks').getAll());
            const storedAssets = requestDone(transaction.objectStore('assets').getAll());
            const [snapshots, entries, values] = await Promise.all([Promise.all(records), masks, storedAssets, done]);
            const assets = new Map(values.map(asset => [asset.id, asset]));
            for (const entry of entries) maskRevisions.set(entry.id, entry.revision);
            for (let index = 0; index < modes.length; index++) {
                const mode = modes[index], record = snapshots[index];
                if (!record) continue;
                try {
                    if (record.schema !== 1 || !record.data) throw new Error('保存的数据版本不受支持');
                    const state = stateFor(mode);state.revision = record.revision;state.assets = new Set(record.assets);state.data = record.data;
                    const snapshot = decode(record.data, state, assets);
                    await controllers[mode].restore(mode === 'sam' ? { ...snapshot, masks: entries } : snapshot);
                } catch (error) { blocked.add(mode);fail(mode, new Error(mode + ' 工作区恢复失败：' + error.message)); }
            }
        } catch (error) { for (const mode of modes) blocked.add(mode);fail('database', error); }
        finally { restoring = false;status(); }
    }
    function flush() {
        for (const mode of [...pending.keys()]) { clearTimeout(pending.get(mode));enqueue(mode); }
        return chain;
    }
    return { schedule, restore, flush, isDirty: () => !restoring && Boolean(pending.size || queued || errors.size) };
}
