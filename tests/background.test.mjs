// Runs background.js against a stubbed chrome.* and a recording canvas, to
// check the state machine (which icon, when, and how often it is repainted).
import fs from "node:fs";
import vm from "node:vm";
import { ROOT } from "./lib.mjs";

const results = [];
const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail: String(detail) });

const calls = { icons: [], badges: [] };
const renders = [];
const listeners = {};
const on = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });

function makeContext() {
  const ctx = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    Promise
  });

  class FakeCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      const ops = [];
      const state = { filter: "none", fillStyle: "", strokeStyle: "", lineWidth: 1 };
      const record = { ops, state, size: this.width };
      renders.push(record);
      return {
        set filter(value) { state.filter = value; },
        get filter() { return state.filter; },
        set fillStyle(value) { state.fillStyle = value; },
        get fillStyle() { return state.fillStyle; },
        set strokeStyle(value) { state.strokeStyle = value; },
        get strokeStyle() { return state.strokeStyle; },
        set lineWidth(value) { state.lineWidth = value; },
        get lineWidth() { return state.lineWidth; },
        drawImage: () => ops.push({ op: "drawImage", filter: state.filter }),
        beginPath: () => ops.push({ op: "beginPath" }),
        arc: (cx, cy, r) => ops.push({ op: "arc", cx, cy, r, fillStyle: state.fillStyle, strokeStyle: state.strokeStyle, lineWidth: state.lineWidth }),
        fill: () => ops.push({ op: "fill", fillStyle: state.fillStyle }),
        stroke: () => ops.push({ op: "stroke", strokeStyle: state.strokeStyle, lineWidth: state.lineWidth }),
        getImageData: (x, y, w, h) => ({
          width: w,
          height: h,
          data: new Uint8ClampedArray(w * h * 4),
          __size: w,
          __ops: ops
        })
      };
    }
  }

  Object.assign(ctx, {
    OffscreenCanvas: FakeCanvas,
    createImageBitmap: async (blob) => ({ blob }),
    fetch: async (url) => ({ blob: async () => ({ url }) }),
    importScripts: (...files) => {
      for (const file of files) {
        vm.runInContext(fs.readFileSync(`${ROOT}/${file}`, "utf8"), ctx, { filename: file });
      }
    },
    chrome: {
      runtime: {
        getURL: (path) => `chrome-extension://fake/${path}`,
        onMessage: on("message"),
        onStartup: on("startup"),
        onInstalled: on("installed")
      },
      tabs: {
        query: async () => [{ id: 1 }, { id: 2 }],
        onRemoved: on("removed")
      },
      action: {
        setIcon: async (details) => {
          calls.icons.push({
            tabId: details.tabId,
            sizes: Object.keys(details.imageData).map(Number).sort((a, b) => a - b),
            ops: details.imageData[16].__ops,
            imageData: details.imageData
          });
        },
        setBadgeText: async (details) => { calls.badges.push(details); }
      }
    }
  });

  return ctx;
}

const ctx = makeContext();
vm.runInContext(fs.readFileSync(`${ROOT}/background.js`, "utf8"), ctx, { filename: "background.js" });

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const lastIcon = () => calls.icons[calls.icons.length - 1];
const iconsFor = (tabId) => calls.icons.filter((call) => call.tabId === tabId);
const arc = (call) => (call.ops || []).find((op) => op.op === "arc");
const fillOf = (call) => { const op = (call?.ops || []).find((o) => o.op === "fill"); return op && op.fillStyle; };
const strokeOf = (call) => (call?.ops || []).find((o) => o.op === "stroke") || {};
const paintedGrey = (call) => (call.ops || []).some((op) => op.op === "drawImage" && op.filter === "grayscale(1)");
const paintedColour = (call) => (call.ops || []).some((op) => op.op === "drawImage" && op.filter === "none");

await tick(30);

check("paints a grey default with no tab id", calls.icons.length === 1 && calls.icons[0].tabId === undefined, JSON.stringify(calls.icons.map((c) => c.tabId)));
check("default icon is the grayscale render", paintedGrey(calls.icons[0]) && !arc(calls.icons[0]), JSON.stringify(calls.icons[0]?.ops));
check("default icon covers 16/32/48", JSON.stringify(calls.icons[0].sizes) === "[16,32,48]", JSON.stringify(calls.icons[0].sizes));

const send = (msg, tabId = 5) => listeners.message(msg, { tab: { id: tabId } });

send({ type: "state", enabled: true }, 5);
await tick();
check("enabled page gets a coloured icon", lastIcon().tabId === 5 && paintedColour(lastIcon()) && !paintedGrey(lastIcon()), JSON.stringify(lastIcon().ops));
check("enabled page icon has no dot", !arc(lastIcon()), JSON.stringify(lastIcon().ops));

send({ type: "state", enabled: false }, 5);
await tick();
check("excluded page falls back to grey", lastIcon().tabId === 5 && paintedGrey(lastIcon()) && !arc(lastIcon()), JSON.stringify(lastIcon().ops));

send({ type: "waiting" }, 5);
await tick();
const waiting = arc(lastIcon());
check("waiting draws an amber dot", fillOf(lastIcon()) === "#edaf4b", JSON.stringify(lastIcon().ops));
check("dot is in the bottom-right half", waiting && waiting.cx > 8 && waiting.cy > 8, waiting ? `cx ${waiting.cx}, cy ${waiting.cy}` : "none");
check("dot carries the dark rim", strokeOf(lastIcon()).strokeStyle === "#2b3440" && strokeOf(lastIcon()).lineWidth >= 1, JSON.stringify(strokeOf(lastIcon())));
check("dot keeps off the icon edge", waiting && waiting.cx + waiting.r + waiting.lineWidth / 2 <= 16 - 1, waiting ? `outer edge ${waiting.cx + waiting.r + waiting.lineWidth / 2}` : "none");

const beforeDuplicate = calls.icons.length;
send({ type: "applied" }, 5);
await tick();
const applied = arc(lastIcon());
check("applied draws a green dot", fillOf(lastIcon()) === "#80d682", JSON.stringify(lastIcon().ops));

const afterApplied = calls.icons.length;
send({ type: "applied" }, 5);
await tick();
check("repeat of the same state repaints nothing", calls.icons.length === afterApplied, `${beforeDuplicate} -> ${afterApplied} -> ${calls.icons.length}`);

listeners.removed(5);
send({ type: "applied" }, 5);
await tick();
check("state is forgotten when the tab closes", calls.icons.length === afterApplied + 1, `${afterApplied} -> ${calls.icons.length}`);

const beforeIgnored = calls.icons.length;
listeners.message({ type: "state", enabled: true }, {});
await tick();
check("messages without a tab are ignored", calls.icons.length === beforeIgnored, `${beforeIgnored} -> ${calls.icons.length}`);

// Ordering: two states in the same tick must land in the order they happened.
send({ type: "waiting" }, 7);
send({ type: "applied" }, 7);
await tick();
const tab7 = iconsFor(7);
check("last state wins when two arrive together",
  tab7.length === 2 && fillOf(tab7[0]) === "#edaf4b" && fillOf(tab7[1]) === "#80d682",
  tab7.map((c) => fillOf(c)).join(" -> "));

// Icon rendering is cached per state and size.
const renderCount = renders.length;
send({ type: "state", enabled: true }, 9);
send({ type: "waiting" }, 9);
send({ type: "applied" }, 9);
send({ type: "state", enabled: false }, 9);
await tick();
check("each variant is rendered once", renders.length - renderCount === 0, `${renderCount} -> ${renders.length} (4 states x 3 sizes = 12 total)`);
check("twelve renders cover four states at three sizes", renders.length === 12, `${renders.length}`);

calls.icons.length = 0;
calls.badges.length = 0;
await listeners.installed();
await tick();
check("reload resets every open tab to grey", calls.icons.length === 2 && calls.icons.every((c) => c.tabId !== undefined && paintedGrey(c)), JSON.stringify(calls.icons.map((c) => c.tabId)));
check("reload clears leftover badges", calls.badges.length === 2 && calls.badges.every((b) => b.text === ""), JSON.stringify(calls.badges));

// A browser restart starts a fresh worker with empty paint memory, and per-tab
// icons do not survive it, so the startup listener is what puts grey back.
const restartMark = calls.icons.length;
const restarted = makeContext();
vm.runInContext(fs.readFileSync(`${ROOT}/background.js`, "utf8"), restarted, { filename: "background.js" });
await tick(30);
const afterRestart = calls.icons.slice(restartMark);
check("a restarted worker paints the grey default",
  afterRestart.length === 1 && afterRestart[0].tabId === undefined && paintedGrey(afterRestart[0]),
  JSON.stringify(afterRestart.map((c) => c.tabId)));

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : "  -> " + r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
