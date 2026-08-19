# handover/ — 跨会话记忆模板（OpenViking + 文件交接）

让 DSH 会话内容「不隔离」的配套三件套：语义记忆走 OpenViking，精确交接走文件。
新会话开局自动注入工作区 AGENTS.md；工具清单出现 mcp__openviking__* 后，按全局
AGENTS.md 的约定开工 recall/find、收工 remember。

## 文件与安装位置

| 模板 | 安装位置 | 作用 |
| --- | --- | --- |
| `AGENTS.md.global.example.md` | `~/.dsh/AGENTS.md` | 全局指令（所有会话生效）：开工 recall/find、收工 remember、先读交接文件 |
| `AGENTS.md.workspace.example.md` | 工作区根目录 `AGENTS.md` | 工作区指令 + 会话连续性协议，新会话开局自动注入 |
| `HANDOFF.example.md` | 工作区 `.dsh/HANDOFF.md` | 精确交接文件：当前主线、已完成、待办、风险、关键命令与路径 |
| `cordis.patch.openviking.yml` | 追加进 `~/.dsh/cordis.patch.yml` | OpenViking MCP 桥接，提供 mcp__openviking__* 工具 |

## 前置

1. OpenViking 服务：`pip install openviking` → `openviking init`（配置 embedding
   provider）→ `openviking-server`（默认 `http://127.0.0.1:1933/mcp`）。
2. 把桥接项追加进 `~/.dsh/cordis.patch.yml`，完整重启 DSH。

## 验证

1. 新会话的工具清单中出现 16 个 `mcp__openviking__*` 工具
   （health/find/search/recall/read/write/edit/remember/...）。
2. 会话上下文自动注入工作区 `AGENTS.md` 内容（锚定类 preset 在晋升后延迟一步注入）。
3. 跨会话召回：会话 A 用 `remember` 写入结论，会话 B 用 `find`/`recall` 能检索到。
