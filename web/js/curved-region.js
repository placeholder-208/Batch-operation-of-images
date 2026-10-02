const LIMITS = {
    maxPixels: 360000,
    maxModels: 12,
    geometryMs: 2000,
    maxFinderGroups: 3,
    maxAnalysisPixels: 1000000,
    minModulePixels: 3
};

const sleepTick = () => new Promise(resolve => setTimeout(resolve, 0));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const point = (x, y) => ({ x, y });

function components(gray, width, height, threshold) {
    const labels = new Int32Array(gray.length).fill(-1);
    const queue = new Int32Array(gray.length);
    const found = [];
    for (let seed = 0; seed < gray.length; seed++) {
        if (labels[seed] !== -1) continue;
        const id = found.length, black = gray[seed] < threshold;
        const c = {
            id, black, area: 0, x: 0, y: 0,
            left: width, top: height, right: -1, bottom: -1,
            pixels: [], neighbors: new Map()
        };
        let head = 0, tail = 1;
        queue[0] = seed; labels[seed] = id;
        while (head < tail) {
            const pos = queue[head++], x = pos % width, y = Math.floor(pos / width);
            c.area++; c.x += x; c.y += y; c.pixels.push(pos);
            c.left = Math.min(c.left, x); c.right = Math.max(c.right, x);
            c.top = Math.min(c.top, y); c.bottom = Math.max(c.bottom, y);
            const visit = next => {
                if (labels[next] < 0 && (gray[next] < threshold) === black) {
                    labels[next] = id; queue[tail++] = next;
                }
            };
            if (x > 0) visit(pos - 1);
            if (x + 1 < width) visit(pos + 1);
            if (y > 0) visit(pos - width);
            if (y + 1 < height) visit(pos + width);
        }
        c.x /= c.area; c.y /= c.area;
        found.push(c);
    }
    const link = (a, b) => {
        if (a === b) return;
        found[a].neighbors.set(b, (found[a].neighbors.get(b) || 0) + 1);
        found[b].neighbors.set(a, (found[b].neighbors.get(a) || 0) + 1);
    };
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const pos = y * width + x;
            if (x + 1 < width) link(labels[pos], labels[pos + 1]);
            if (y + 1 < height) link(labels[pos], labels[pos + width]);
        }
    }
    return found;
}

function neighbor(c, found, exclude = -1) {
    let best = null, count = -1;
    for (const [id, value] of c.neighbors) {
        if (id !== exclude && value > count) { best = found[id]; count = value; }
    }
    return best;
}

function encloses(a, b) {
    return a.left <= b.left && a.top <= b.top &&
        a.right >= b.right && a.bottom >= b.bottom;
}

function cross(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function quadrilateral(component, width) {
    const points = component.pixels.map(pos => point(pos % width, Math.floor(pos / width)));
    points.sort((a, b) => a.x - b.x || a.y - b.y);
    const lower = [], upper = [];
    for (const p of points) {
        while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
        lower.push(p);
    }
    for (let i = points.length - 1; i >= 0; i--) {
        const p = points[i];
        while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
        upper.push(p);
    }
    const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    while (hull.length > 4) {
        let index = 0, smallest = Infinity;
        for (let i = 0; i < hull.length; i++) {
            const area = Math.abs(cross(hull[(i + hull.length - 1) % hull.length], hull[i], hull[(i + 1) % hull.length]));
            if (area < smallest) { smallest = area; index = i; }
        }
        hull.splice(index, 1);
    }
    return hull.length === 4 ? hull : null;
}

async function findStructures(gray, width, height, deadline) {
    const groups = [], alignments = [];
    for (let threshold = 70; threshold <= 190; threshold += 20) {
        if (performance.now() > deadline) break;
        const found = components(gray, width, height, threshold), finders = [];
        for (const center of found) {
            if (!center.black || center.area > gray.length / 8) continue;
            const gap = neighbor(center, found);
            if (!gap || gap.black || !encloses(gap, center)) continue;
            if (!gap.left || !gap.top || gap.right === width - 1 || gap.bottom === height - 1) continue;
            const ratio = gap.area / center.area;
            if (ratio > 3 && ratio < 16) alignments.push({ x: center.x, y: center.y, ratio });
            if (center.area < 5 || ratio <= 0.6 || ratio >= 4) continue;
            const ring = neighbor(gap, found, center.id);
            if (!ring || !ring.black || !encloses(ring, gap)) continue;
            const ringRatio = ring.area / center.area;
            if (ringRatio <= 1.1 || ringRatio >= 6) continue;
            finders.push({ x: center.x, y: center.y, area: center.area, ring });
        }
        finders.sort((a, b) => b.area - a.area);
        const pool = finders.slice(0, 12);
        for (let i = 0; i < pool.length - 2; i++) {
            for (let j = i + 1; j < pool.length - 1; j++) {
                for (let k = j + 1; k < pool.length; k++) {
                    const triple = [pool[i], pool[j], pool[k]];
                    for (let pivot = 0; pivot < 3; pivot++) {
                        const tl = triple[pivot], arms = triple.filter((_, index) => index !== pivot);
                        const ax = arms[0].x - tl.x, ay = arms[0].y - tl.y;
                        const bx = arms[1].x - tl.x, by = arms[1].y - tl.y;
                        const lengthA = Math.hypot(ax, ay), lengthB = Math.hypot(bx, by);
                        const cosine = Math.abs(ax * bx + ay * by) / (lengthA * lengthB);
                        const module = Math.sqrt(tl.area / 9);
                        if (!Number.isFinite(cosine) || cosine > 0.65 || Math.min(lengthA, lengthB) < module * 10) continue;
                        if (ax * by - ay * bx < 0) arms.reverse();
                        groups.push({ cosine, threshold, finders: [tl, ...arms] });
                    }
                }
            }
        }
        await sleepTick();
    }
    groups.sort((a, b) => Math.round(a.cosine * 100) - Math.round(b.cosine * 100) || a.threshold - b.threshold);
    const distinct = [];
    for (const g of groups) {
        if (distinct.some(other => g.finders.every((f, i) =>
            distance(f, other.finders[i]) <= Math.max(1.5, Math.sqrt(f.area / 9) * 0.6)))) continue;
        distinct.push(g);
        if (distinct.length === 3) break;
    }
    return { group: distinct[0], groups: distinct, alignments };
}

function orderedCorners(finders, width) {
    const [tl, tr, bl] = finders;
    const ax = tr.x - tl.x, ay = tr.y - tl.y;
    const bx = bl.x - tl.x, by = bl.y - tl.y;
    const determinant = ax * by - ay * bx;
    if (Math.abs(determinant) < 1) return null;
    const result = [];
    for (const f of finders) {
        const quad = quadrilateral(f.ring, width);
        if (!quad) return null;
        const local = quad.map(p => {
            const x = p.x - f.x, y = p.y - f.y;
            return point((by * x - bx * y) / determinant, (-ay * x + ax * y) / determinant);
        });
        const ids = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
            let best = -Infinity, index = -1;
            local.forEach((p, i) => {
                const score = sx * p.x + sy * p.y;
                if (score > best) { best = score; index = i; }
            });
            return index;
        });
        if (new Set(ids).size !== 4) return null;
        for (const id of ids) {
            const p = quad[id], length = distance(p, f);
            // Approximate compensation for contours measured at pixel centers.
            result.push(point(p.x + 0.7 * (p.x - f.x) / length, p.y + 0.7 * (p.y - f.y) / length));
        }
    }
    return result.concat(finders.map(f => point(f.x, f.y)));
}

function leastSquares(rows, rhs) {
    const size = rows[0].length;
    const matrix = Array.from({ length: size }, () => new Float64Array(size + 1));
    for (let r = 0; r < rows.length; r++) {
        for (let i = 0; i < size; i++) {
            matrix[i][size] += rows[r][i] * rhs[r];
            for (let j = 0; j < size; j++) matrix[i][j] += rows[r][i] * rows[r][j];
        }
    }
    for (let i = 0; i < size; i++) {
        let pivot = i;
        for (let j = i + 1; j < size; j++) if (Math.abs(matrix[j][i]) > Math.abs(matrix[pivot][i])) pivot = j;
        if (Math.abs(matrix[pivot][i]) < 1e-11) return null;
        [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]];
        const value = matrix[i][i];
        for (let j = i; j <= size; j++) matrix[i][j] /= value;
        for (let row = 0; row < size; row++) {
            if (row === i) continue;
            const factor = matrix[row][i];
            for (let j = i; j <= size; j++) matrix[row][j] -= factor * matrix[i][j];
        }
    }
    return matrix.map(row => row[size]);
}

function idealPoints(n) {
    const points = [];
    for (const [x, y] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
        points.push(point(x, y), point(x + 7, y), point(x + 7, y + 7), point(x, y + 7));
    }
    return points.concat([point(3.5, 3.5), point(n - 3.5, 3.5), point(3.5, n - 3.5)]);
}

function flatMap(ideal, actual, n, width) {
    const rows = [], rhs = [];
    ideal.forEach((p, i) => {
        const u = p.x / n, v = p.y / n, x = actual[i].x / width, y = actual[i].y / width;
        rows.push([u, v, 1, 0, 0, 0, -x * u, -x * v], [0, 0, 0, u, v, 1, -y * u, -y * v]);
        rhs.push(x, y);
    });
    const c = leastSquares(rows, rhs);
    if (!c) return null;
    return (x, y) => {
        const u = x / n, v = y / n, d = c[6] * u + c[7] * v + 1;
        return point(width * (c[0] * u + c[1] * v + c[2]) / d, width * (c[3] * u + c[4] * v + c[5]) / d);
    };
}

function cylinderMap(ideal, actual, n, k, axis, width) {
    const features = (x, y) => {
        let a = (axis === 0 ? x : y) / n - 0.5;
        let b = (axis === 0 ? y : x) / n;
        if (axis >= 2) {
            const angle = axis === 2 ? Math.PI / 4 : -Math.PI / 4;
            const u = x / n - 0.5, v = y / n - 0.5;
            a = u * Math.cos(angle) + v * Math.sin(angle);
            b = -u * Math.sin(angle) + v * Math.cos(angle) + 0.5;
        }
        return [Math.sin(k * a) / k, b, (1 - Math.cos(k * a)) / (k * k), 1];
    };
    const rows = [], rhs = [];
    ideal.forEach((p, i) => {
        const f = features(p.x, p.y), x = actual[i].x / width, y = actual[i].y / width;
        const weight = i < 12 ? 1 : 2;
        rows.push([...f, 0, 0, 0, 0, ...f.slice(0, 3).map(v => -x * v)].map(v => v * weight));
        rows.push([0, 0, 0, 0, ...f, ...f.slice(0, 3).map(v => -y * v)].map(v => v * weight));
        rhs.push(x * weight, y * weight);
    });
    const c = leastSquares(rows, rhs);
    if (!c) return null;
    return (x, y) => {
        const f = features(x, y), d = c[8] * f[0] + c[9] * f[1] + c[10] * f[2] + 1;
        return point(width * f.reduce((sum, v, i) => sum + v * c[i], 0) / d,
            width * f.reduce((sum, v, i) => sum + v * c[i + 4], 0) / d);
    };
}

function extrema(source, width, height, radius, minimum) {
    const temp = new Float64Array(source.length), result = new Float64Array(source.length);
    const pass = (input, output, lines, length, stride, lineStride) => {
        const deque = new Int32Array(length);
        for (let line = 0; line < lines; line++) {
            let head = 0, tail = 0, next = 0;
            const base = line * lineStride;
            for (let i = 0; i < length; i++) {
                while (next <= Math.min(length - 1, i + radius)) {
                    const value = input[base + next * stride];
                    while (tail > head && (minimum ? input[base + deque[tail - 1] * stride] >= value : input[base + deque[tail - 1] * stride] <= value)) tail--;
                    deque[tail++] = next++;
                }
                while (deque[head] < i - radius) head++;
                output[base + i * stride] = input[base + deque[head] * stride];
            }
        }
    };
    pass(source, temp, height, width, 1, width);
    pass(temp, result, width, height, width, 1);
    return result;
}

function sample(values, width, height, p) {
    const x = Math.max(0, Math.min(width - 1, p.x)), y = Math.max(0, Math.min(height - 1, p.y));
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    return values[y0 * width + x0] * (1 - fx) * (1 - fy) + values[y0 * width + x1] * fx * (1 - fy) +
        values[y1 * width + x0] * (1 - fx) * fy + values[y1 * width + x1] * fx * fy;
}

function sampleGrid(map, values, width, height, n) {
    const centers = [], samples = new Float64Array(n * n);
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const center = map(x + 0.5, y + 0.5);
            if (!Number.isFinite(center.x + center.y) || center.x < 0 || center.y < 0 || center.x >= width || center.y >= height) return null;
            centers.push(center);
            let sum = 0;
            for (const dy of [-0.22, 0, 0.22]) for (const dx of [-0.22, 0, 0.22]) {
                const p = map(x + 0.5 + dx, y + 0.5 + dy);
                if (!Number.isFinite(p.x + p.y)) return null;
                sum += sample(values, width, height, p);
            }
            samples[y * n + x] = sum / 9;
        }
    }
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
        if (cross(centers[y * n + x], centers[y * n + x + 1], centers[(y + 1) * n + x]) <= 0) return null;
    }
    return samples;
}

// 定位失败时使用局部均值消除缓慢变化的亮度背景。
function localContrast(gray, width, height) {
    const stride = width + 1;
    const integral = new Float64Array(stride * (height + 1));
    for (let y = 0; y < height; y++) {
        let sum = 0;
        for (let x = 0; x < width; x++) {
            sum += gray[y * width + x];
            integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + sum;
        }
    }
    const radius = Math.max(7, Math.min(25, Math.round(Math.min(width, height) / 24)));
    return gray.map((value, i) => {
        const x = i % width, y = Math.floor(i / width);
        const x0 = Math.max(0, x - radius), x1 = Math.min(width, x + radius + 1);
        const y0 = Math.max(0, y - radius), y1 = Math.min(height, y + radius + 1);
        const sum = integral[y1 * stride + x1] - integral[y0 * stride + x1] -
            integral[y1 * stride + x0] + integral[y0 * stride + x0];
        return Math.max(0, Math.min(255, value - sum / ((x1 - x0) * (y1 - y0)) + 128));
    });
}

function normalizeImage(imageData, moduleSize) {
    const { width, height, data } = imageData;
    const gray = new Float64Array(width * height);
    for (let i = 0; i < gray.length; i++) {
        const alpha = data[i * 4 + 3] / 255;
        gray[i] = alpha * (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) + 255 * (1 - alpha);
    }
    const windowSize = Math.max(5, Math.min(63, Math.round(moduleSize * 2.4) | 1));
    const radius = (windowSize - 1) / 2;
    const low = extrema(gray, width, height, radius, true);
    const high = extrema(gray, width, height, radius, false);
    return gray.map((v, i) => Math.max(0, Math.min(1, (v - low[i]) / Math.max(30, high[i] - low[i]))));
}

function formatCode(data) {
    const bits = data << 10;
    let remainder = bits;
    while (remainder >= 1024) remainder ^= 0x537 << (31 - Math.clz32(remainder) - 10);
    return (bits | remainder) ^ 0x5412;
}

function hamming(value) {
    let count = 0;
    while (value) { value &= value - 1; count++; }
    return count;
}

function formatInformation(samples, n, cutoff) {
    const first = [], second = [];
    for (let x = 0; x < 6; x++) first.push(point(x, 8));
    first.push(point(7, 8), point(8, 8), point(8, 7));
    for (let y = 5; y >= 0; y--) first.push(point(8, y));
    for (let y = n - 1; y >= n - 7; y--) second.push(point(8, y));
    for (let x = n - 8; x < n; x++) second.push(point(x, 8));
    const info = [first, second].map(locations => {
        let bits = 0, best = { errors: Infinity, data: -1 };
        for (const p of locations) bits = (bits << 1) | Number(samples[p.y * n + p.x] < cutoff);
        for (let data = 0; data < 32; data++) {
            const errors = hamming(bits ^ formatCode(data));
            if (errors < best.errors) best = { errors, data };
        }
        return best;
    });
    return info[0].data === info[1].data && info.every(i => i.errors <= 2) ? info : null;
}

export async function analyzeCurvedImage(imageData, options = {}) {
    const limits = { ...LIMITS, ...options }, started = performance.now(), deadline = started + limits.geometryMs;
    const { width, height, data } = imageData;
    const diagnostics = { width, height, finders: [], models: 0 };
    const finish = models => ({ models, diagnostics: { ...diagnostics, elapsedMs: Math.round(performance.now() - started) } });
    if (width * height > limits.maxPixels) { diagnostics.reason = 'region-too-large'; return finish([]); }
    const gray = new Float64Array(width * height);
    for (let i = 0; i < gray.length; i++) {
        const alpha = data[i * 4 + 3] / 255;
        gray[i] = alpha * (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) + 255 * (1 - alpha);
    }
    let { group, groups, alignments } = await findStructures(gray, width, height, deadline);
    diagnostics.finderMode = 'gray';
    if (!group && performance.now() < deadline) {
        ({ group, groups, alignments } = await findStructures(localContrast(gray, width, height), width, height, deadline));
        diagnostics.finderMode = 'local-contrast';
    }
    if (!group) { diagnostics.reason = 'finder-triple-not-found'; return finish([]); }
    diagnostics.finders = group.finders.map(f => point(f.x, f.y));
    diagnostics.moduleSize = group.finders.map(f => Math.sqrt(f.area / 9)).sort((a,b)=>a-b)[1];
    diagnostics.finderGroups = groups.length;
    if (options.probeOnly) return finish([]);
    const models = [];
    diagnostics.groupsAttempted = 0;
    for (let groupIndex = 0; groupIndex < Math.min(groups.length, limits.maxFinderGroups); groupIndex++) {
        if (performance.now() > deadline) { diagnostics.reason = 'geometry-budget-reached'; break; }
        group = groups[groupIndex];
        diagnostics.groupsAttempted++;
        const groupDeadline = Math.min(deadline, performance.now() +
            (deadline - performance.now()) / (Math.min(groups.length, limits.maxFinderGroups) - groupIndex));
        const finders = group.finders.map(f => point(f.x, f.y));
        const observed = orderedCorners(group.finders, width);
        if (!observed) { continue; }
        const modules = group.finders.map(f => Math.sqrt(f.area / 9)).sort((a, b) => a - b);
        const moduleSize = modules[1];
        if (groupIndex === 0) diagnostics.moduleSize = moduleSize;
        const window = Math.max(5, Math.min(31, Math.round(moduleSize * 2.4) | 1)), radius = (window - 1) / 2;
        const low = extrema(gray, width, height, radius, true), high = extrema(gray, width, height, radius, false);
        const normalized = gray.map((v, i) => Math.max(0, Math.min(1, (v - low[i]) / Math.max(30, high[i] - low[i]))));
        const estimatedDimension = 7 + (distance(group.finders[0], group.finders[1]) + distance(group.finders[0], group.finders[2])) / (2 * moduleSize);
        const dimensions = Array.from({ length: 40 }, (_, i) => 21 + i * 4)
            .sort((a, b) => Math.abs(a - estimatedDimension) - Math.abs(b - estimatedDimension));
        sizeLoop: for (const n of dimensions) {
            if (performance.now() > groupDeadline) { diagnostics.groupBudgetLimited = (diagnostics.groupBudgetLimited || 0) + 1; break; }
            const ideal = idealPoints(n), flat = flatMap(ideal, observed, n, width);
            if (!flat) continue;
            const predicted = flat(n - 6.5, n - 6.5);
            let alignment = null, best = Infinity;
            for (const a of alignments) {
                const d = distance(a, predicted);
                if (d >= moduleSize * 4) continue;
                const score = d / moduleSize + Math.abs(Math.log(a.ratio / 8));
                if (score < best) { best = score; alignment = a; }
            }
            // 版本 1 是 21×21，无校正方块，仅使用三个定位方块的角点与中心拟合。
            if (n !== 21 && !alignment) continue;
            const controls = n === 21 ? ideal : ideal.concat([point(n - 6.5, n - 6.5)]);
            const actual = n === 21 ? observed : observed.concat([alignment]);
            const axes = [0, 1, 2, 3];
            for (const axis of axes) for (const curvature of [0.4, 0.8, 1.2, 1.6, 2]) {
                if (performance.now() > groupDeadline) { diagnostics.groupBudgetLimited = (diagnostics.groupBudgetLimited || 0) + 1; break sizeLoop; }
                const map = cylinderMap(controls, actual, n, curvature, axis, width);
                if (!map) continue;
                const samples = sampleGrid(map, normalized, width, height, n);
                if (!samples) continue;
                let sum = 0;
                controls.forEach((p, i) => { sum += distance(map(p.x, p.y), actual[i]) ** 2; });
                const rms = Math.sqrt(sum / controls.length);
                for (const cutoff of [0.5, 0.65, 0.75]) {
                    const info = formatInformation(samples, n, cutoff);
                    if (!info) continue;
                    let correct = 0, total = 0;
                    for (let i = 8; i < n - 8; i++) {
                        correct += Number((samples[6 * n + i] < cutoff) === (i % 2 === 0));
                        correct += Number((samples[i * n + 6] < cutoff) === (i % 2 === 0));
                        total += 2;
                    }
                    const timing = correct / total;
                    if (timing < 0.8) continue;
                    const score = timing - 0.03 * rms / moduleSize - 0.02 * (info[0].errors + info[1].errors);
                    models.push({ dimension: n, curvature, axis, cutoff, timing, rms, score, samples, map, groupIndex, moduleSize, finders });
                }
            }
            await sleepTick();
        }
    }
    models.sort((a, b) => b.score - a.score);
    diagnostics.models = models.length;
    if (!models.length && !diagnostics.reason) diagnostics.reason = 'no-accepted-model';
    // 轮流保留各定位组合的高分模型，避免某一组占满整个解码预算。
    const buckets = Array.from({length: groups.length}, (_, i) => models.filter(m => m.groupIndex === i));
    const selected = [];
    for (let round = 0; selected.length < limits.maxModels; round++) {
        let added = false;
        for (const bucket of buckets) {
            if (!bucket[round]) continue;
            selected.push(bucket[round]); added = true;
            if (selected.length === limits.maxModels) break;
        }
        if (!added) break;
    }
    return finish(selected);
}

export function renderCurvedModel(model) {
    const n = model.dimension, pixels = 8, margin = 4, width = (n + margin * 2) * pixels;
    const data = new Uint8ClampedArray(width * width * 4).fill(255);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        if (model.samples[y * n + x] >= model.cutoff) continue;
        for (let dy = 0; dy < pixels; dy++) for (let dx = 0; dx < pixels; dx++) {
            const pos = (((y + margin) * pixels + dy) * width + (x + margin) * pixels + dx) * 4;
            data[pos] = data[pos + 1] = data[pos + 2] = 0;
        }
    }
    return { data, width, height: width };
}

export async function decodeCurvedRegion(canvas, options = {}) {
    const started = performance.now();
    const limits = { ...LIMITS, ...options };
    // 原图采样需要读取像素，单独保留内存保护；普通大图不再被 36 万像素限制跳过。
    if (canvas.width * canvas.height > 6000000) {
        console.log('[局部曲面解码]', {
            width: canvas.width, height: canvas.height,
            reason: 'source-memory-limit', attempted: 0, decoded: 0
        });
        return [];
    }
    let analysisCanvas = canvas;
    const area = canvas.width * canvas.height;
    let targetPixels = Math.min(limits.maxPixels, limits.maxAnalysisPixels);
    let moduleSizeHint = options.moduleSizeHint;
    let resolutionMode = 'base';
    const makeAnalysisCanvas = (pixels) => {
        const scale = Math.min(1, Math.sqrt(pixels / area));
        if (scale >= 1) return canvas;
        const result = document.createElement('canvas');
        result.width = Math.max(1, Math.floor(canvas.width * scale));
        result.height = Math.max(1, Math.floor(canvas.height * scale));
        const context = result.getContext('2d', { willReadFrequently: true });
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(canvas, 0, 0, result.width, result.height);
        return result;
    };
    if (!(moduleSizeHint > 0) && area > targetPixels) {
        const probeCanvas = makeAnalysisCanvas(targetPixels);
        const probeData = probeCanvas.getContext('2d', {willReadFrequently: true})
            .getImageData(0, 0, probeCanvas.width, probeCanvas.height);
        const probe = await analyzeCurvedImage(probeData, {...limits, probeOnly: true, geometryMs: 150});
        moduleSizeHint = probe.diagnostics.moduleSize * Math.sqrt(area / (probeCanvas.width * probeCanvas.height));
        if (!(moduleSizeHint > 0)) {
            targetPixels = limits.maxAnalysisPixels;
            resolutionMode = 'no-scale-estimate-fallback';
        }
    }
    if (moduleSizeHint > 0) {
        const minimumScale = Math.min(1, limits.minModulePixels / moduleSizeHint);
        targetPixels = Math.min(limits.maxAnalysisPixels, Math.max(targetPixels, area * minimumScale * minimumScale));
        resolutionMode = 'module-aware';
    }
    analysisCanvas = makeAnalysisCanvas(targetPixels);
    const imageData = analysisCanvas.getContext('2d', { willReadFrequently: true })
        .getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);
    const { models, diagnostics } = await analyzeCurvedImage(imageData, {
        ...limits, maxPixels: targetPixels,
        geometryMs: Math.max(100, limits.geometryMs - (performance.now() - started))
    });
    const scaleX = canvas.width / analysisCanvas.width;
    const scaleY = canvas.height / analysisCanvas.height;
    let sourceData = null;
    const normalizedCache = new Map();
    if (analysisCanvas !== canvas && models.length) {
        sourceData = canvas.getContext('2d', { willReadFrequently: true })
            .getImageData(0, 0, canvas.width, canvas.height);
    }
    const logInfo = {
        ...diagnostics,
        width: canvas.width, height: canvas.height,
        analysisWidth: analysisCanvas.width, analysisHeight: analysisCanvas.height,
        rescaled: analysisCanvas !== canvas,
        resolutionMode, moduleSizeHint,
        finders: diagnostics.finders.map(p => point((p.x + 0.5) * scaleX - 0.5, (p.y + 0.5) * scaleY - 0.5))
    };
    let attempted = 0;
    for (const model of models) {
        const originalMap = (x, y) => {
            const p = model.map(x, y);
            return point((p.x + 0.5) * scaleX - 0.5, (p.y + 0.5) * scaleY - 0.5);
        };
        let samplingModel = model;
        if (sourceData) {
            const sourceModule = model.moduleSize * Math.sqrt(scaleX * scaleY);
            const key = Math.max(5, Math.min(63, Math.round(sourceModule * 2.4) | 1));
            if (!normalizedCache.has(key)) normalizedCache.set(key, normalizeImage(sourceData, sourceModule));
            const sourceNormalized = normalizedCache.get(key);
            const samples = sampleGrid(originalMap, sourceNormalized, canvas.width, canvas.height, model.dimension);
            if (!samples) continue;
            samplingModel = { ...model, samples };
        }
        const rendered = renderCurvedModel(samplingModel);
        const results = await window.ZXingWASM.readBarcodes(new ImageData(rendered.data, rendered.width, rendered.height), {
            formats: ['QRCode'], tryHarder: true
        });
        attempted++;
        const decoded = results.filter(r => r.isValid !== false && r.text && r.position).map(r => {
            const points = [r.position.topLeft, r.position.topRight, r.position.bottomRight, r.position.bottomLeft]
                .map(p => originalMap(p.x / 8 - 4, p.y / 8 - 4));
            return {
                text: r.text, format: r.format || 'QRCode', points,
                center: point(points.reduce((sum, p) => sum + p.x, 0) / 4, points.reduce((sum, p) => sum + p.y, 0) / 4),
                source: 'wechat-local-curved'
            };
        }).filter(r => r.points.every(p => Number.isFinite(p.x + p.y)));
        if (decoded.length) {
            console.log('[局部曲面解码]', { ...logInfo, finders: model.finders.map(p => point((p.x + 0.5) * scaleX - 0.5, (p.y + 0.5) * scaleY - 0.5)), groupIndex: model.groupIndex, attempted, decoded: decoded.length, dimension: model.dimension, version: (model.dimension - 17) / 4, axis: model.axis, curvature: model.curvature, totalMs: Math.round(performance.now() - started) });
            return decoded;
        }
        await sleepTick();
    }
    console.log('[局部曲面解码]', { ...logInfo, attempted, decoded: 0, totalMs: Math.round(performance.now() - started) });
    return [];
}
