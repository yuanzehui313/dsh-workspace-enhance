# dsh-workspace-enhance

中文 | [English](README.en.md)

DeepSeek Harness（DSH）工作区与会话管理增强插件。以**标准 DSH 插件包**形式发布，核心改动以
**overlay 补丁集**方式覆盖官方 `@deepseek-ai/dsh-*` 的 17 个 bundle（这些改动点位于
apiproxy RPC 表、工作区注册表、工作区浏览器 UI 等不可叠加扩展的内部实现中），配套一键
安装 / 回滚 / 校验脚本。

## 功能清单

1. **回收站**（软删除 / 恢复 / 彻底删除，会话 + 工作区）：`session.delete` 变为移入回收站，
   物理删除仅能从回收站执行（`session.purge` / `workspace.purge`）。
2. **跨工作区拖动会话**：会话行可拖到其他工作区行（或「未分组」组）移动归属，关系持久化，
   会话自身目录与日志不动。
3. **未分组工作区**：顶部「新会话」按钮创建的新会话自动进入「未分组」组；未分组组常驻显示。
4. **多文件夹工作区**：每个工作区可挂载多个根目录（`additionalPaths`），沙箱同步授权全部根目录。
5. **应用内目录选择器**：Windows 下使用内置浏览式选择器（含驱动器列表），不再弹原生对话框。
6. **文件夹行展开**：侧边栏文件夹行可递归展开查看内部文件/目录。
7. **会话合并**：多选会话合并为带完整子树的合并会话；归档 = 归档全部子会话并保留源会话。
8. **会话行图标**：分叉 / 归档 / 删除直接图标 + 分叉树形渲染；重命名图标从 ⋯ 菜单提出，
   会话行 ⋯ 菜单已移除。
9. **工作区行图标**：合并 / 重命名 / 新建会话 / 管理文件夹 / 删除 直接平铺，合并图标使用
   独立链条图标，与分叉 / 归档图标区分。
10. **回收站样式**：与工作区同层级的分组行（垃圾桶图标、粗体品牌蓝标题、默认展开、点击收起、
    条目与标题左对齐）。
11. **文件预览面板**：点击侧边栏文件夹树中的**文件**，右侧滑出 520px 预览面板——标题栏显示
    文件名与完整路径，正文使用与对话消息同款的 **Markdown 渲染**：`.md` 文件按 Markdown
    排版（标题/列表/代码块/表格/链接等），`.js/.ts/.vue/.json/.java/.py/.xml/.yml/.css/.html`
    等 30+ 种代码文件自动包进对应语言的语法高亮代码块；由服务端新增的 `host.readFile` RPC
    提供内容（限制在工作区根目录内，≤256KB，二进制文件拒绝预览）。
12. **修复**：回收站 RPC 信封解包错误、服务端默认 cwd 为盘符根目录（`C:\`）导致未分组会话
    创建失败等。

## 安装

前置：已安装 DeepSeek Harness（`@deepseek-ai/dsh@0.1.0-rc.6`）。

```powershell
# 1. 安装插件包到 DSH profile（插件清单中可见 dsh-workspace-enhance）
npm install --prefix "$env:USERPROFILE\.dsh\profiles" dsh-workspace-enhance

# 2. 应用 overlay 补丁集（自动备份）
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.dsh\profiles\node_modules\dsh-workspace-enhance\scripts\install.ps1"

# 3. 重启 DSH 服务，浏览器 Ctrl+Shift+R 强刷
```

校验与回滚：

```powershell
powershell -ExecutionPolicy Bypass -File "...\scripts\verify.ps1"    # 检查补丁是否生效
powershell -ExecutionPolicy Bypass -File "...\scripts\uninstall.ps1" # 从最近一次备份回滚
```

## 终端（TUI）适配

配合 [`@dsh-tui/dsh-tui`](https://github.com/openguardrails/dsh-tui)（Claude Code 风格终端界面）使用：

```powershell
# 1. 安装 TUI 插件到独立 profile（需 Node ^22.19 || >=24，且已安装 pnpm）
dsh plugin --profile tui add @dsh-tui/dsh-tui

# 2. 安装本插件（声明了 dsh.bundle 层，会自动加入 profile 组合）
dsh plugin --profile tui add github:yuanzehui313/dsh-workspace-enhance

# 3. TUI profile 的宿主包从 dsh CLI 安装目录解析，overlay 需指向那里
powershell -ExecutionPolicy Bypass -File "...\scripts\install.ps1" -TargetRoot "C:\...\node_modules\@deepseek-ai"

# 4. 启动（需要真实终端）
dsh --profile tui
```

终端下可用斜杠命令（宿主侧注册，Web 界面同样可调用）：

| 命令 | 作用 |
|---|---|
| `/trash` | 列出回收站中的会话与工作区 |
| `/trash-restore <id>` | 恢复回收站条目 |
| `/trash-purge <id>` | 彻底删除回收站条目 |
| `/move <sessionId> <workspaceId \| ungrouped>` | 把会话移动到其他工作区（或移出为未分组） |
| `/preview <path>` | 预览工作区内的文件（Markdown 渲染，代码文件自动高亮） |

说明：Web 侧的侧边栏 UI（回收站分组、拖动、预览面板等）仅存在于 Web 界面；TUI 通过
上述命令驱动同一套宿主能力（回收站 / 跨工作区移动 / 文件读取共用同一份持久化状态）。

## 补丁持久性

- overlay 安装时采用「删除后复制」方式落盘，**与官方包的硬链接断开**——DSH 宿主用
  `npx -y @deepseek-ai/dsh web` 重启服务时重新拉取官方包，不会连带覆盖已打补丁的文件。
- Web 界面的插件解析以 **profile 的 `node_modules\@deepseek-ai`** 为准（补丁落在这里）。
- TUI 建议固定使用一个完整的 dsh 安装（例如 `%USERPROFILE%\.dsh\dsh-pinned`，把 overlay
  同时装到该目录），启动脚本直接 `node` 该目录下的 `bin.js`，绕开 npx 缓存刷新。
- 升级 DSH 版本后需重新核对 overlay（`verify.ps1` 会报告 REVERTED）。

## 目录结构

```
dsh-workspace-enhance/
├── package.json        # 标准 DSH 插件元数据（dsh.client → lib/client.js）
├── lib/
│   ├── index.js        # 宿主侧 Cordis 服务（插件清单可见性 + 能力标记）
│   └── client.js       # 客户端插件（标准 __ModuleLoader__ 形式）
├── overlay/            # 覆盖补丁集（与 @deepseek-ai 相对路径一致，17 个 bundle）
├── scripts/            # install / uninstall / verify
└── README.md（中文，GitHub 默认展示）/ README.en.md（英文）
```

## 兼容性

目标版本：`@deepseek-ai/dsh@0.1.0-rc.6`（Windows）。升级 DSH 版本后需重新核对 overlay
与新版 bundle 的差异（`verify.ps1` 会报告 REVERTED）。

## License

MIT
