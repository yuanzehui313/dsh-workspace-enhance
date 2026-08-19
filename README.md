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
9. **工作区行图标**：合并 / 重命名 / 新建会话 / 删除 直接平铺，合并图标使用
   独立链条图标，与分叉 / 归档图标区分。（「管理文件夹」图标已移除，其入口改为
   文件夹区 / 文件区标题行右侧的 + 按钮。）
10. **回收站样式**：与工作区同层级的分组行（垃圾桶图标、粗体品牌蓝标题、默认展开、点击收起、
    条目与标题左对齐）。
11. **文件预览面板**：点击侧边栏文件夹树中的**文件**，右侧滑出 520px 预览面板——标题栏显示
    文件名与完整路径，正文使用与对话消息同款的 **Markdown 渲染**：`.md` 文件按 Markdown
    排版（标题/列表/代码块/表格/链接等），`.js/.ts/.vue/.json/.java/.py/.xml/.yml/.css/.html`
    等 30+ 种代码文件自动包进对应语言的语法高亮代码块；由服务端新增的 `host.readFile` RPC
    提供内容（限制在工作区根目录内，≤256KB，二进制文件拒绝预览）。
12. **修复**：回收站 RPC 信封解包错误、服务端默认 cwd 为盘符根目录（`C:\`）导致未分组会话
    创建失败等。
13. **文件夹区 / 文件区分区**：每个工作区组内渲染两块独立区域——文件夹区（蓝色底，列出
    主目录 + 全部附加目录，主目录不可移除）在上，文件区（紫色底，列出公共文件或空态提示）
    在下；两个区标题行均可点击折叠/展开，无文件时仍保留占位；未分组区域不渲染这两块。
14. **多选文件/文件夹选择器**：两个区标题行右侧的 + 按钮打开内置多选浏览器（盘符级入口，
    目录点击进入、勾选框多选、可跨目录保持选择；条目列表 320px 高度内滚动）；确认后目录
    流入文件夹区、文件流入文件区；取消直接返回页面。
15. **会话文件**：粘贴（Ctrl+V）到会话的文件发送后经 `workspace.importFiles` 写入工作区
    `.dsh-uploads/` 并以 sessionId 挂载到该会话行上方（绿色区块 + 左竖条强调线，标题显示
    「会话文件 · N 个文件 · 会话标题」）；区块点击折叠，文件行常显 × 可移除、点击弹出预览。
16. **附件放开限制**：粘贴/拖拽任意格式文件均可作为附件（图片四格式仍走图片管线）；二进制
    发送只带 `[附件 文件名]` 标注；附件芯片显示扩展名徽标 + 文件名；大小限制只作用于真正
    传输内容的图片与文本。
17. **拖拽上传**：文件可直接拖入文件区（虚线高亮），经 `workspace.importFiles` 落盘
    `.dsh-uploads/`（重名自动编号，≤5MB/个）并立即展示；文件行点击即预览。
18. **预览增强**：文件行（公共/会话）与文件夹树文件均可点击预览；`host.readFile` 对二进制
    返回 base64，预览面板内联渲染 png/jpg/jpeg/gif/webp/svg 图片；Markdown/30+ 代码语言
    同前。
19. **细节收敛**：文件夹区只列附加目录（不含工作区主目录，空时显示 + 提示）；文件区底部
    常驻虚线拖放区；对话框的拖拽监听与高亮遮罩收窄到输入框内部（不再全屏拦截）。
20. **跨会话记忆模板**：`handover/` 目录内置 OpenViking MCP 桥接配置片段与全局/工作区
    AGENTS.md、HANDOFF.md 模板，配套「语义记忆 + 文件交接」的会话内容不隔离方案
    （详见下文「跨会话记忆（OpenViking + 文件交接）」）。

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

## 补丁持久性

- overlay 安装时采用「删除后复制」方式落盘，**与官方包的硬链接断开**——DSH 宿主用
  `npx -y @deepseek-ai/dsh web` 重启服务时重新拉取官方包，不会连带覆盖已打补丁的文件。
- Web 界面的插件解析以 **profile 的 `node_modules\@deepseek-ai`** 为准（补丁落在这里）。
- 升级 DSH 版本后需重新核对 overlay（`verify.ps1` 会报告 REVERTED）。

## 跨会话记忆（OpenViking + 文件交接）

插件自带 `handover/` 模板目录，把 DSH 默认「会话隔离」改成「内容不隔离」的混合交接：

- **语义记忆（OpenViking）**：把 `handover/cordis.patch.openviking.yml` 的补丁项追加进
  `~/.dsh/cordis.patch.yml` 并重启 DSH，新会话即获得 16 个 `mcp__openviking__*` 工具
  （find / search / recall / remember / read / write / …）。会话开工先 recall/find 检索，
  收工把结论与决策 remember 写入。
- **精确交接（文件）**：`handover/` 提供全局 `AGENTS.md`、工作区 `AGENTS.md` 与
  `HANDOFF.md` 三份模板（见 `handover/README.md` 的安装位置表）。工作区 AGENTS.md 在
  新会话开局自动注入，HANDOFF.md 在每个里程碑结束更新。

OpenViking 服务前置：`pip install openviking` → `openviking init` → `openviking-server`
（默认 `http://127.0.0.1:1933/mcp`）。

## 目录结构

```
dsh-workspace-enhance/
├── package.json        # 标准 DSH 插件元数据（dsh.client → lib/client.js）
├── lib/
│   ├── index.js        # 宿主侧 Cordis 服务（插件清单可见性 + 能力标记）
│   └── client.js       # 客户端插件（标准 __ModuleLoader__ 形式）
├── overlay/            # 覆盖补丁集（与 @deepseek-ai 相对路径一致，17 个 bundle）
├── handover/           # 跨会话记忆模板（OpenViking 桥接 + AGENTS.md/HANDOFF.md）
├── scripts/            # install / uninstall / verify
└── README.md（中文，GitHub 默认展示）/ README.en.md（英文）
```

## 兼容性

目标版本：`@deepseek-ai/dsh@0.1.0-rc.6`（Windows）。升级 DSH 版本后需重新核对 overlay
与新版 bundle 的差异（`verify.ps1` 会报告 REVERTED）。

## License

MIT
