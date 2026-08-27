/**
 * dsh-workspace-enhance cost meter (host half): computes per-day LLM token
 * usage and cost from the DSH session logs and serves it to the web GUI.
 *
 * - Data: parses the DSH session logs under `~/.dsh/sessions` (multi-frame zstd),
 *   aggregating provider-reported usage events (`assistant/message` and
 *   `assistant/chunk` usage samples, last-wins per step) whose event time
 *   falls inside each calendar day.
 * - Pricing: per-model prices (input / cache-hit / output, USD per 1M tokens)
 *   and the CNY conversion rate are read from
 *   `~/.dsh/cost-meter/config.json` (auto-created with DeepSeek official API
 *   defaults on first run).
 * - Cache: the 7-day summary is cached at `~/.dsh/cost-meter/week.json` and
 *   recomputed only when a session log is newer than the cache or the day
 *   changes.
 * - Route: `GET /cost-meter/daily` → `{ ok, value: { today, week } }`.
 *
 * Zero-dependency (node builtins only).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";

const DSH_HOME = process.env.DSH_HOME || join(homedir(), ".dsh");
const SESSIONS_ROOT = join(DSH_HOME, "sessions");
const META_ROOT = join(DSH_HOME, "cost-meter");
const WEEK_DAYS = 7;

/** DeepSeek official API prices (USD per 1M tokens) used as defaults. */
export const DEFAULT_PRICES = {
  "deepseek-v4-pro": { input: 0.55, cache: 0.07, output: 2.19 },
  "deepseek-v4-flash": { input: 0.27, cache: 0.07, output: 1.1 },
};
export const DEFAULT_CURRENCY_RATE = 7.2;

const ZSTD_MAGIC = 4247762216; // 0x28B52FFD

// ---------- config ----------

function loadConfig() {
  const cfg = { prices: { ...DEFAULT_PRICES }, currencyRate: DEFAULT_CURRENCY_RATE };
  try {
    if (!existsSync(META_ROOT)) mkdirSync(META_ROOT, { recursive: true });
    const path = join(META_ROOT, "config.json");
    if (!existsSync(path)) {
      writeFileSync(path, JSON.stringify(cfg, null, 2), "utf8");
      return cfg;
    }
    const raw = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
    if (raw && typeof raw === "object") {
      if (raw.prices && typeof raw.prices === "object") cfg.prices = { ...cfg.prices, ...raw.prices };
      if (typeof raw.currencyRate === "number" && raw.currencyRate > 0) cfg.currencyRate = raw.currencyRate;
    }
  } catch {
    // keep defaults on any config problem
  }
  return cfg;
}

// ---------- zstd ----------

function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) break;
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break;
    offset += 4;
    if (offset === buffer.length) break;
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    for (;;) {
      if (buffer.length - offset < 3) return frames;
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) return frames;
      offset += blockType === 1 ? 1 : blockSize;
      if (lastBlock) break;
    }
    if (checksum) offset += 4;
    frames.push({ start, end: offset });
  }
  return frames;
}

function decodeSessionLog(path) {
  let text = "";
  try {
    const buf = readFileSync(path);
    for (const frame of scanZstdFrames(buf)) {
      try {
        text += zstdDecompressSync(buf.subarray(frame.start, frame.end)).toString("utf8");
      } catch {
        // skip a corrupt frame; keep the rest
      }
    }
  } catch {
    return "";
  }
  return text;
}

// ---------- aggregation ----------

function walkSessionFiles(root, minMtimeMs) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".jsonl.zstd") || entry.name.endsWith(".jsonl")) {
        try {
          if (statSync(full).mtimeMs >= minMtimeMs) out.push(full);
        } catch {
          // skip unreadable
        }
      }
    }
  };
  walk(root);
  return out;
}

function localDateLabel(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/**
 * Compute the per-day token usage for the last `WEEK_DAYS` days (local time).
 * @returns {Array<{date:string, requests:number, models:Record<string,{requests:number,input:number,cacheRead:number,output:number,tokens:number,costUsd:number,costCny:number}>, totals:{tokens:number,costUsd:number,costCny:number}}>}
 */
export function computeWeek() {
  const cfg = loadConfig();
  const now = new Date();
  const days = [];
  for (let i = WEEK_DAYS - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push({
      date: localDateLabel(d),
      start: d.getTime(),
      end: d.getTime() + 86400000,
      models: new Map(),
      requests: 0,
    });
  }
  const files = walkSessionFiles(SESSIONS_ROOT, days[0].start - 86400000);

  for (const file of files) {
    const lines = decodeSessionLog(file).split("\n").filter(Boolean);
    const stepUsage = new Map(); // `${turn}|${step}` -> { usage, model, dayIndex }
    let fallbackModel = "unknown";
    for (const line of lines) {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof event.time !== "number") continue;
      let dayIndex = -1;
      for (let i = 0; i < days.length; i += 1) {
        if (event.time >= days[i].start && event.time < days[i].end) {
          dayIndex = i;
          break;
        }
      }
      if (dayIndex < 0) continue;
      if (event.type === "request/header") {
        const cfgEntry = event.data?.header?.config;
        if (cfgEntry?.model) fallbackModel = cfgEntry.model;
        continue;
      }
      let usage;
      let model;
      if (event.type === "assistant/message" && event.data?.usage) {
        usage = event.data.usage;
        model = event.data.model ?? event.data.message?.model ?? fallbackModel;
      } else if (event.type === "assistant/chunk" && event.data?.chunk?.type === "usage" && event.data.chunk.usage) {
        usage = event.data.chunk.usage;
        model = fallbackModel;
      } else {
        continue;
      }
      const key = `${event.data.turn}|${event.data.step}`;
      stepUsage.set(key, { usage, model, dayIndex }); // last-wins per step
    }
    for (const { usage, model, dayIndex } of stepUsage.values()) {
      const bucket = days[dayIndex];
      bucket.requests += 1;
      const agg = bucket.models.get(model) ?? { requests: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
      agg.requests += 1;
      agg.input += usage.inputTokens ?? 0;
      agg.cacheRead += usage.cacheReadTokens ?? 0;
      agg.cacheWrite += usage.cacheWriteTokens ?? 0;
      agg.output += usage.outputTokens ?? 0;
      bucket.models.set(model, agg);
    }
  }

  // 组装输出 + 计价
  const result = [];
  for (const bucket of days) {
    const models = {};
    let tokens = 0;
    let costUsd = 0;
    for (const [model, agg] of bucket.models) {
      const price = cfg.prices[model] ?? { input: 0, cache: 0, output: 0 };
      const mTokens = agg.input + agg.cacheRead + agg.cacheWrite + agg.output;
      const mCost = (agg.input * price.input + agg.cacheRead * price.cache + (agg.cacheWrite ?? 0) * (price.cache ?? 0) + agg.output * price.output) / 1e6;
      tokens += mTokens;
      costUsd += mCost;
      models[model] = { ...agg, tokens: mTokens, costUsd: mCost, costCny: mCost * cfg.currencyRate };
    }
    result.push({
      date: bucket.date,
      requests: bucket.requests,
      models,
      totals: { tokens, costUsd, costCny: costUsd * cfg.currencyRate },
    });
  }
  return result;
}

// ---------- cache ----------

/** Cached week summary; recomputes only when session logs changed or the day rolled over. */
export function getWeekSummary() {
  const now = new Date();
  const todayLabel = localDateLabel(now);
  if (!existsSync(META_ROOT)) mkdirSync(META_ROOT, { recursive: true });
  const cachePath = join(META_ROOT, "week.json");
  const newestSession = walkSessionFiles(SESSIONS_ROOT, 0).reduce((max, f) => {
    try {
      return Math.max(max, statSync(f).mtimeMs);
    } catch {
      return max;
    }
  }, 0);
  const cutoff = Math.max(newestSession, now.getTime() - 5 * 60000);
  let cached = null;
  try {
    if (existsSync(cachePath) && statSync(cachePath).mtimeMs >= cutoff) {
      cached = JSON.parse(readFileSync(cachePath, "utf8").replace(/^\uFEFF/, ""));
    }
  } catch {
    cached = null;
  }
  if (cached?.date === todayLabel && Array.isArray(cached.days) && cached.days.length === WEEK_DAYS) {
    return cached.days;
  }
  const days = computeWeek();
  try {
    writeFileSync(cachePath, JSON.stringify({ date: todayLabel, days }, null, 2), "utf8");
  } catch {
    // cache write is best-effort
  }
  return days;
}

// ---------- HTTP route ----------

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

/** Register GET /cost-meter/daily on the shared DSH webserver (if mounted). */
export function registerCostMeter(ctx) {
  const webserver = ctx.get("webServer");
  if (webserver === undefined) return false;
  webserver.register({
    kind: "prefix",
    path: "/cost-meter",
    handler: async (req, res) => {
      try {
        const pathname = new URL(req.url ?? "/", "http://local").pathname;
        if (req.method !== "GET" || pathname !== "/cost-meter/daily") {
          sendJson(res, 404, { ok: false, error: { code: "not-found", message: `no route: ${pathname}` } });
          return;
        }
        const days = getWeekSummary();
        sendJson(res, 200, { ok: true, value: { today: days[days.length - 1], week: days } });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: { code: "internal", message: String(err?.message ?? err) } });
      }
    },
  });
  return true;
}
