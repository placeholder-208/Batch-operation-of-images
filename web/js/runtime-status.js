const states = new Map();
const listeners = new Set();
export function report(module, text, level = "info") {
    const value = {module, text, level};
    states.set(module, value);
    for (const listener of listeners) {
        try { listener(value); } catch (error) { console.warn("状态显示更新失败", error); }
    }
}
export function subscribe(listener) {
    listeners.add(listener);
    for (const state of states.values()) listener(state);
    return () => listeners.delete(listener);
}
