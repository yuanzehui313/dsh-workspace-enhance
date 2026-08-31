/**
 * dsh-workspace-enhance cost meter (host half): computes per-day LLM token
 * usage and cost from the DSH session logs and serves it to the web GUI.
 *
 * - Data: parses the DSH session logs under `~/.dsh/sessions` (multi-frame zstd),
 *   aggregating provider-reported usage events (`assistant/message` and
 *   `assistant/chunk` usage samples, last-wins per step) whose event time
 *   falls inside each calendar day.
 * - Pricing: DeepSeek official API prices (CNY per 1M tokens), split by
 *   peak / off-peak time and by cache-hit / cache-miss / output. Editable at
 *   `~/.dsh/cost-meter/config.json` (auto-created with the official defaults).
 *   Peak = Beijing Mon-Fri 9:00-12:00 & 14:00-18:00; everything else off-peak.
 * - Deleted sessions: DSH soft-deletes sessions — the row disappears from
 *   `~/.dsh/storages/session-query.db` (`persisted_sessions`) but the log file
 *   stays on disk. The meter therefore only counts log files whose session id
 *   is still present in that table (falls back to counting everything when the
 *   DB is unavailable).
 * - Cache: the 7-day summary is cached at `~/.dsh/cost-meter/week.json` as
 *   per-file day buckets (incremental): a session log is only re-decoded when
 *   its size/mtime changed, so an active session costs one file per refresh
 *   instead of a full re-decode of every log. The live session set is applied
 *   at merge time, so soft-deleted sessions drop out without re-decoding.
 * - Route: `GET /cost-meter/daily` → `{ ok, value: { today, week } }`.
 *
 * Zero-dependency (node builtins only).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";

const require = createRequire(import.meta.url);

const DSH_HOME = process.env.DSH_HOME || join(homedir(), ".dsh");
const SESSIONS_ROOT = join(DSH_HOME, "sessions");
const META_ROOT = join(DSH_HOME, "cost-meter");
const WEEK_DAYS = 7;
const PRICING_SCHEMA = 2;

/**
 * DeepSeek official API prices (CNY per 1M tokens), from
 * https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 * Peak = Beijing Mon-Fri 9:00-12:00, 14:00-18:00; off-peak = all other times.
 */
export const DEFAULT_PRICES = {
  "deepseek-v4-flash": {
    cacheHit: { peak: 0.10, offpeak: 0.05 },
    cacheMiss: { peak: 3.0, offpeak: 1.5 },
    output: { peak: 9.0, offpeak: 4.5 },
  },
  "deepseek-v4-pro": {
    cacheHit: { peak: 0.30, offpeak: 0.15 },
    cacheMiss: { peak: 9.0, offpeak: 4.5 },
    output: { peak: 27.0, offpeak: 13.5 },
  },
  "deepseek-v4-flash-vision-exp": {
    cacheHit: { peak: 0.10, offpeak: 0.05 },
    cacheMiss: { peak: 3.0, offpeak: 1.5 },
    output: { peak: 9.0, offpeak: 4.5 },
  },
};
/** USD display is derived from the official CNY prices (informational only). */
export const DEFAULT_CURRENCY_RATE = 7.2;

const ZSTD_MAGIC = 4247762216; // 0x28B52FFD

// ---------- config ----------

function defaultConfig() {
  return { schema: PRICING_SCHEMA, prices: { ...DEFAULT_PRICES }, currencyRate: DEFAULT_CURRENCY_RATE };
}

function loadConfig() {
  const cfg = defaultConfig();
  try {
    if (!existsSync(META_ROOT)) mkdirSync(META_ROOT, { recursive: true });
    const path = join(META_ROOT, "config.json");
    if (!existsSync(path)) {
      writeFileSync(path, JSON.stringify(cfg, null, 2), "utf8");
      return cfg;
    }
    const raw = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
    if (raw && typeof raw === "object" && raw.schema === PRICING_SCHEMA) {
      if (raw.prices && typeof raw.prices === "object") cfg.prices = { ...cfg.prices, ...raw.prices };
      if (typeof raw.currencyRate === "number" && raw.currencyRate > 0) cfg.currencyRate = raw.currencyRate;
    } else {
      // migrate an older/foreign config shape (e.g. the previous USD prices)
      writeFileSync(path, JSON.stringify(cfg, null, 2), "utf8");
    }
  } catch {
    // keep defaults on any config problem
  }
  return cfg;
}

// ---------- live sessions (authoritative list) ----------

/**
 * Matches session dir names in all shapes DSH uses on disk / in the DB:
 * `session-<uuid>`, `main-session-<uuid>`, or a bare `<uuid>`.
 */
const SESSION_DIR_RE = /^([a-z]+-)?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * Live session ids from the DSH session store (`session-query.db` →
 * `persisted_sessions`). Sessions deleted from the GUI are removed here while
 * their log files stay on disk, so this set decides which logs to count.
 * @returns {{raw:Set<string>, norm:Set<string>, has:(name:string)=>boolean}|null}
 *   null when the DB is unavailable
 */
export function liveSessionIds() {
  try {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(join(DSH_HOME, "storages", "session-query.db"), { readOnly: true });
    try {
      const rows = db.prepare("SELECT id FROM persisted_sessions").all();
      const raw = new Set();
      const norm = new Set();
      for (const row of rows) {
        const id = String(row.id);
        raw.add(id);
        norm.add(id.replace(/^(?:[a-z]+-)?session-/, ""));
      }
      return {
        raw,
        norm,
        has(name) {
          if (!name) return false;
          if (raw.has(name)) return true;
          return norm.has(String(name).replace(/^(?:[a-z]+-)?session-/, ""));
        },
      };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

// ---------- zstd ----------

export function scanZstdFrames(buffer) {
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

export function decodeSessionLog(path) {
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

/**
 * Walk the session log tree.
 * @returns {Array<{path:string, sessionId:string|null}>} files with their
 *   raw session dir name (null when the parent dir is not a session dir).
 */
function walkSessionFiles(root, minMtimeMs) {
  const out = [];
  const walk = (dir, sessionId) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, SESSION_DIR_RE.test(entry.name) ? entry.name : sessionId);
      } else if (entry.name.endsWith(".jsonl.zstd") || entry.name.endsWith(".jsonl")) {
        try {
          if (statSync(full).mtimeMs >= minMtimeMs) out.push({ path: full, sessionId });
        } catch {
          // skip unreadable
        }
      }
    }
  };
  walk(root, null);
  return out;
}

function localDateLabel(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** Peak = Beijing Mon-Fri 9:00-12:00 and 14:00-18:00; off-peak otherwise. */
function isPeakTime(date) {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  const h = date.getHours();
  return (h >= 9 && h < 12) || (h >= 14 && h < 18);
}

function emptyAgg() {
  return {
    requests: 0,
    input: 0, cacheRead: 0, cacheWrite: 0, output: 0,
    inputPeak: 0, inputOff: 0,
    cacheReadPeak: 0, cacheReadOff: 0,
    outputPeak: 0, outputOff: 0,
  };
}

function makeWindow() {
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
  return days;
}

/**
 * Aggregate one session log's usage into per-day buckets (last-wins per step,
 * like the previous full scan). Lines are pre-filtered by substring so the
 * (potentially huge) log is not fully JSON-parsed.
 * @returns {Map<number, {requests:number, models:Map<string, object>}>} dayIndex → bucket
 */
function aggregateFileUsage(text, days) {
  const out = new Map();
  const stepUsage = new Map(); // `${turn}|${step}` -> { usage, model, dayIndex, time }
  let fallbackModel = "unknown";
  for (const line of text.split("\n")) {
    if (!line) continue;
    // 预过滤：只有 usage 事件与 request/header（提供 fallback 模型）需要解析
    if (!line.includes('"usage"') && !line.includes('"request/header"')) continue;
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
    stepUsage.set(`${event.data.turn}|${event.data.step}`, { usage, model, dayIndex, time: event.time }); // last-wins per step
  }
  for (const { usage, model, dayIndex, time } of stepUsage.values()) {
    let bucket = out.get(dayIndex);
    if (!bucket) {
      bucket = { requests: 0, models: new Map() };
      out.set(dayIndex, bucket);
    }
    bucket.requests += 1;
    const agg = bucket.models.get(model) ?? emptyAgg();
    const input = usage.inputTokens ?? 0;
    const cacheRead = usage.cacheReadTokens ?? 0;
    const cacheWrite = usage.cacheWriteTokens ?? 0;
    const output = usage.outputTokens ?? 0;
    const peak = isPeakTime(new Date(time));
    agg.requests += 1;
    agg.input += input;
    agg.cacheRead += cacheRead;
    agg.cacheWrite += cacheWrite;
    agg.output += output;
    if (peak) {
      agg.inputPeak += input;
      agg.cacheReadPeak += cacheRead;
      agg.outputPeak += output;
    } else {
      agg.inputOff += input;
      agg.cacheReadOff += cacheRead;
      agg.outputOff += output;
    }
    bucket.models.set(model, agg);
  }
  return out;
}

/** Merge one file's per-day usage into the window buckets. */
function mergeFileUsage(days, fileUsage) {
  for (const [dayIndex, fileBucket] of fileUsage) {
    const bucket = days[dayIndex];
    bucket.requests += fileBucket.requests;
    for (const [model, agg] of fileBucket.models) {
      const cur = bucket.models.get(model) ?? emptyAgg();
      cur.requests += agg.requests;
      cur.input += agg.input;
      cur.cacheRead += agg.cacheRead;
      cur.cacheWrite += agg.cacheWrite;
      cur.output += agg.output;
      cur.inputPeak += agg.inputPeak;
      cur.inputOff += agg.inputOff;
      cur.cacheReadPeak += agg.cacheReadPeak;
      cur.cacheReadOff += agg.cacheReadOff;
      cur.outputPeak += agg.outputPeak;
      cur.outputOff += agg.outputOff;
      bucket.models.set(model, cur);
    }
  }
}

/** 计价 + 组装输出（官方人民币价：缓存未命中 input / 缓存命中 cacheRead / 输出 output） */
function buildResult(days, cfg) {
  const result = [];
  for (const bucket of days) {
    const models = {};
    let tokens = 0;
    let costCny = 0;
    for (const [model, agg] of bucket.models) {
      const price = cfg.prices[model];
      const mTokens = agg.input + agg.cacheRead + agg.cacheWrite + agg.output;
      let mCostCny = 0;
      if (price && typeof price === "object") {
        mCostCny = (
          agg.inputPeak * (price.cacheMiss?.peak ?? 0) + agg.inputOff * (price.cacheMiss?.offpeak ?? 0) +
          agg.cacheReadPeak * (price.cacheHit?.peak ?? 0) + agg.cacheReadOff * (price.cacheHit?.offpeak ?? 0) +
          agg.outputPeak * (price.output?.peak ?? 0) + agg.outputOff * (price.output?.offpeak ?? 0)
        ) / 1e6;
      }
      tokens += mTokens;
      costCny += mCostCny;
      models[model] = {
        requests: agg.requests,
        input: agg.input,
        cacheRead: agg.cacheRead,
        cacheWrite: agg.cacheWrite,
        output: agg.output,
        tokens: mTokens,
        costUsd: mCostCny / cfg.currencyRate,
        costCny: mCostCny,
      };
    }
    result.push({
      date: bucket.date,
      requests: bucket.requests,
      models,
      totals: { tokens, costUsd: costCny / cfg.currencyRate, costCny },
    });
  }
  return result;
}

/**
 * Full scan path (fallback / tests): decode every session log in the window.
 * @returns {Array<{date:string, requests:number, models:Record<string,object>, totals:object}>}
 */
export function computeWeek() {
  const cfg = loadConfig();
  const days = makeWindow();
  const files = walkSessionFiles(SESSIONS_ROOT, days[0].start - 86400000);
  const live = liveSessionIds(); // null → DB unavailable, count everything
  for (const file of files) {
    // 软删除的会话：DB 里已无此 id，日志虽在磁盘上但不再计费
    if (live && !live.has(file.sessionId)) continue;
    mergeFileUsage(days, aggregateFileUsage(decodeSessionLog(file.path), days));
  }
  return buildResult(days, cfg);
}

// ---------- cache ----------

/** week.json 结构版本（files 增量缓存）；pricing 版本仍由 PRICING_SCHEMA 管。 */
const CACHE_FORMAT = 2;

/**
 * 7-day summary with a per-file incremental cache: only session logs whose
 * size/mtime changed since the last run are re-decoded; soft-deleted sessions
 * (logs kept on disk, row gone from session-query.db) are dropped at merge
 * time without any re-decode.
 */
export function getWeekSummary() {
  const cfg = loadConfig();
  const days = makeWindow();
  if (!existsSync(META_ROOT)) mkdirSync(META_ROOT, { recursive: true });
  const cachePath = join(META_ROOT, "week.json");
  const dateSet = new Set(days.map((d) => d.date));
  const live = liveSessionIds(); // null → DB unavailable, count everything

  // 1. 遍历日志（stat-only，快）
  const files = walkSessionFiles(SESSIONS_ROOT, days[0].start - 86400000).map((f) => ({
    path: f.path,
    sessionId: f.sessionId,
    rel: f.path.slice(SESSIONS_ROOT.length).replace(/\\/g, "/"),
  }));

  // 2. 读缓存
  let cached = null;
  try {
    if (existsSync(cachePath)) cached = JSON.parse(readFileSync(cachePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    cached = null;
  }
  const fileCache =
    cached?.version === PRICING_SCHEMA && cached?.cacheFormat === CACHE_FORMAT && cached?.files && typeof cached.files === "object"
      ? cached.files
      : {};

  // 3. 逐文件：未变 → 复用；变更 → 只重解码这一个
  const fresh = {};
  for (const file of files) {
    let st;
    try {
      st = statSync(file.path);
    } catch {
      continue;
    }
    const hit = fileCache[file.rel];
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
      fresh[file.rel] = hit;
      continue;
    }
    const usage = aggregateFileUsage(decodeSessionLog(file.path), days);
    const entry = { mtimeMs: st.mtimeMs, size: st.size, days: {} };
    for (const [dayIndex, u] of usage) {
      entry.days[days[dayIndex].date] = { requests: u.requests, models: Object.fromEntries(u.models) };
    }
    fresh[file.rel] = entry;
  }

  // 4. 合并（此处应用活体会话过滤：软删除会话的日志即使仍在磁盘也不计费）
  for (const file of files) {
    if (live && !live.has(file.sessionId)) continue;
    const entry = fresh[file.rel];
    if (!entry) continue;
    for (const [dateLabel, dayEntry] of Object.entries(entry.days)) {
      if (!dateSet.has(dateLabel)) continue;
      const bucket = days.find((d) => d.date === dateLabel);
      bucket.requests += dayEntry.requests;
      for (const [model, agg] of Object.entries(dayEntry.models)) {
        const cur = bucket.models.get(model) ?? emptyAgg();
        cur.requests += agg.requests;
        cur.input += agg.input;
        cur.cacheRead += agg.cacheRead;
        cur.cacheWrite += agg.cacheWrite;
        cur.output += agg.output;
        cur.inputPeak += agg.inputPeak;
        cur.inputOff += agg.inputOff;
        cur.cacheReadPeak += agg.cacheReadPeak;
        cur.cacheReadOff += agg.cacheReadOff;
        cur.outputPeak += agg.outputPeak;
        cur.outputOff += agg.outputOff;
        bucket.models.set(model, cur);
      }
    }
  }

  // 5. 写回缓存（裁剪到当前文件集）
  try {
    writeFileSync(cachePath, JSON.stringify({
      version: PRICING_SCHEMA,
      cacheFormat: CACHE_FORMAT,
      date: localDateLabel(new Date()),
      files: fresh,
    }, null, 2), "utf8");
  } catch {
    // cache write is best-effort
  }

  return buildResult(days, cfg);
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
  // 冷启动预热：后台先算一次增量缓存，避免首个页面请求阻塞十几秒
  // （DB 未就绪时 liveSessionIds 返回 null → 稍后重试，最多 ~40s）
  const warm = (attempts) => {
    setTimeout(() => {
      try {
        if (liveSessionIds()) {
          getWeekSummary();
          return;
        }
      } catch {
        // retry below
      }
      if (attempts > 0) warm(attempts - 1);
    }, 3000);
  };
  warm(13);
  return true;
}
