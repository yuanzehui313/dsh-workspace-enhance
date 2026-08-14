import { Service } from "cordis";
import { createRequire } from "node:module";
import { readFile as fsReadFile, stat } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

export const name = "workspaceEnhance";

export const inject = ["commands"];

const PREVIEW_LIMIT = 256 * 1024;

const CODE_EXTENSIONS = new Set([
  "js", "jsx", "ts", "tsx", "json", "vue", "java", "xml", "yml", "yaml",
  "py", "go", "rs", "c", "cpp", "h", "hpp", "css", "scss", "less",
  "html", "htm", "sh", "ps1", "bat", "cmd", "sql", "toml", "ini",
  "conf", "properties", "gradle"
]);

/** Wrap code-ish files in a fenced block so terminal renderers highlight them. */
function codeFence(path, content) {
  const dot = path.lastIndexOf(".");
  const ext = dot > 0 ? path.slice(dot + 1).toLowerCase() : "";
  if (ext === "md" || ext === "markdown" || !CODE_EXTENSIONS.has(ext)) return content;
  return "```" + ext + "\n" + content + "\n```";
}

function failure(error) {
  return {
    kind: "error",
    text: error instanceof Error ? error.message : String(error)
  };
}

/**
 * Host half of dsh-workspace-enhance.
 *
 * The functional changes of this plugin are an overlay patch-set applied over
 * the official @deepseek-ai/dsh-* bundles (see scripts/install.ps1) because the
 * touched surfaces (the apiproxy RPC map, the workspace registry, the workspace
 * browser UI) are not extensible from an additive plugin. This service is a
 * standard Cordis entry point: it keeps the package discoverable in the DSH
 * plugin inventory and registers slash commands so terminal clients (dsh-tui)
 * can drive the overlay's recycle bin, cross-workspace move, and file preview
 * features without the web sidebar.
 */
class WorkspaceEnhanceService extends Service {
  constructor(ctx) {
    super(ctx, name, false);
  }

  registry() {
    return this.ctx.get("workspaceRegistry");
  }

  persistence() {
    return this.ctx.get("sessionPersistence");
  }

  async [Service.init]() {
    this.ctx.provide("workspaceEnhance", {
      version: pkg.version,
      features: [
        "recycle-bin",
        "cross-workspace-drag",
        "ungrouped-sessions",
        "multi-folder-roots",
        "in-app-directory-picker",
        "session-merge",
        "row-icons",
        "file-preview",
        "tui-commands"
      ]
    });
    await this.ctx.commands.register({
      name: "trash",
      description: "回收站：列出已删除的会话与工作区",
      handler: (invocation) => this.trash(invocation)
    });
    await this.ctx.commands.register({
      name: "trash-restore",
      description: "从回收站恢复：/trash-restore <sessionId | workspaceId>",
      handler: (invocation) => this.trashRestore(invocation)
    });
    await this.ctx.commands.register({
      name: "trash-purge",
      description: "彻底删除回收站条目：/trash-purge <sessionId | workspaceId>",
      handler: (invocation) => this.trashPurge(invocation)
    });
    await this.ctx.commands.register({
      name: "move",
      description: "移动会话到其他工作区：/move <sessionId> <workspaceId | ungrouped>",
      handler: (invocation) => this.move(invocation)
    });
    await this.ctx.commands.register({
      name: "preview",
      description: "预览工作区内的文件：/preview <path>",
      handler: (invocation) => this.preview(invocation)
    });
    if (typeof console !== "undefined") {
      console.info(`[dsh-workspace-enhance] ${pkg.version} host half loaded (commands: /trash /trash-restore /trash-purge /move /preview); run scripts/install.ps1 to apply the overlay patch-set`);
    }
  }

  async trash() {
    try {
      const registry = this.registry();
      const persistence = this.persistence();
      const metas = persistence === void 0 ? [] : await persistence.list();
      const byId = new Map(metas.map((meta) => [meta.id, meta]));
      const lines = [];
      const sessions = [...registry.deletedSessionIds];
      const workspaces = [...registry.deletedWorkspaceIds]
        .map((id) => registry.get(id))
        .filter((workspace) => workspace !== void 0);
      lines.push("回收站会话：" + (sessions.length === 0 ? "（空）" : ""));
      for (const id of sessions) {
        const meta = byId.get(id);
        lines.push(`- ${id}${meta?.cwd === void 0 ? "" : ` · ${basename(meta.cwd)}`}`);
      }
      lines.push("回收站工作区：" + (workspaces.length === 0 ? "（空）" : ""));
      for (const workspace of workspaces) lines.push(`- ${workspace.id} · ${workspace.title} · ${workspace.path}`);
      return {
        kind: "success",
        text: lines.join("\n")
      };
    } catch (error) {
      return failure(error);
    }
  }

  async trashRestore(invocation) {
    const id = invocation.rawInput.trim();
    if (id === "") return {
      kind: "error",
      text: "用法：/trash-restore <sessionId | workspaceId>"
    };
    try {
      const registry = this.registry();
      if (id.startsWith("session-")) {
        if (!registry.deletedSessionIds.includes(id)) return {
          kind: "error",
          text: `会话 ${id} 不在回收站中`
        };
        await registry.restoreSession(id);
        return {
          kind: "success",
          text: `已恢复会话 ${id}`
        };
      }
      if (!registry.deletedWorkspaceIds.includes(id)) return {
        kind: "error",
        text: `工作区 ${id} 不在回收站中`
      };
      await registry.restoreWorkspace(id);
      return {
        kind: "success",
        text: `已恢复工作区 ${id}`
      };
    } catch (error) {
      return failure(error);
    }
  }

  async trashPurge(invocation) {
    const id = invocation.rawInput.trim();
    if (id === "") return {
      kind: "error",
      text: "用法：/trash-purge <sessionId | workspaceId>"
    };
    try {
      const registry = this.registry();
      if (id.startsWith("session-")) {
        if (!registry.deletedSessionIds.includes(id)) return {
          kind: "error",
          text: `会话 ${id} 不在回收站中`
        };
        const persistence = this.persistence();
        if (persistence !== void 0) await persistence.remove(id, invocation.signal);
        await registry.purgeSession(id);
        return {
          kind: "success",
          text: `已彻底删除会话 ${id}`
        };
      }
      if (!registry.deletedWorkspaceIds.includes(id)) return {
        kind: "error",
        text: `工作区 ${id} 不在回收站中`
      };
      await registry.purgeWorkspace(id);
      return {
        kind: "success",
        text: `已彻底删除工作区 ${id}`
      };
    } catch (error) {
      return failure(error);
    }
  }

  async move(invocation) {
    const [sessionId, target] = invocation.rawInput.trim().split(/\s+/);
    if (sessionId === void 0 || sessionId === "" || target === void 0 || target === "") return {
      kind: "error",
      text: "用法：/move <sessionId> <workspaceId | ungrouped>"
    };
    try {
      const registry = this.registry();
      await registry.moveSession(sessionId, target === "ungrouped" ? void 0 : target);
      return {
        kind: "success",
        text: `已将会话 ${sessionId} 移动到 ${target === "ungrouped" ? "「未分组」" : `工作区 ${target}`}`
      };
    } catch (error) {
      return failure(error);
    }
  }

  async preview(invocation) {
    const path = invocation.rawInput.trim();
    if (path === "") return {
      kind: "error",
      text: "用法：/preview <path>"
    };
    try {
      const registry = this.registry();
      const canonical = resolve(path);
      const lower = process.platform === "win32" ? (value) => value.toLowerCase() : (value) => value;
      const allowed = registry.list().some((workspace) => workspace.paths.some((root) => {
        const lr = lower(resolve(root));
        const lt = lower(canonical);
        return lt === lr || lt.startsWith(lr.endsWith(sep) ? lr : lr + sep);
      }));
      if (!allowed) return {
        kind: "error",
        text: `无法预览 "${path}"：路径不在任何工作区根目录内`
      };
      const info = await stat(canonical);
      if (!info.isFile()) return {
        kind: "error",
        text: `无法预览 "${path}"：不是普通文件`
      };
      if (info.size > PREVIEW_LIMIT) return {
        kind: "error",
        text: `无法预览 "${path}"：文件 ${info.size} 字节，超过 ${PREVIEW_LIMIT} 字节上限`
      };
      const buffer = await fsReadFile(canonical);
      const probe = buffer.subarray(0, Math.min(8192, buffer.length));
      for (const byte of probe) if (byte === 0) return {
        kind: "error",
        text: `无法预览 "${path}"：二进制文件`
      };
      return {
        kind: "success",
        text: codeFence(canonical, buffer.toString("utf8"))
      };
    } catch (error) {
      return failure(error);
    }
  }
}

export default WorkspaceEnhanceService;
