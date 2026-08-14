# dsh-workspace-enhance

[中文](README.md) | English

Workspace & session management enhancements for the DeepSeek Harness (DSH).
Published as a standard DSH plugin package; the deep changes ship as an
**overlay patch-set** over the official `@deepseek-ai/dsh-*` bundles (the
touched surfaces — the apiproxy RPC map, the workspace registry, the workspace
browser UI — are closed internals that cannot be extended additively), with
one-command install / rollback / verify scripts.

## Features

1. **Recycle bin** (soft-delete / restore / purge, sessions + workspaces):
   `session.delete` moves to the bin; physical deletion is only possible from
   the bin (`session.purge` / `workspace.purge`).
2. **Cross-workspace session drag**: drag a session row onto another workspace
   row (or the Ungrouped group) to move it; membership is durable, the
   session's own cwd and log are untouched.
3. **Ungrouped workspace**: the top "New session" button creates ungrouped
   sessions; the Ungrouped group is always visible.
4. **Multi-folder workspaces**: each workspace can mount several roots
   (`additionalPaths`); the sandbox grants all of them.
5. **In-app directory picker**: Windows uses the built-in browse picker with a
   drive list instead of the native dialog.
6. **Folder rows expand** to show inner files/directories recursively.
7. **Session merge**: merge selected sessions into one with the full subtree;
   archive = archive all fork children and keep the source.
8. **Session row icons**: fork / archive / delete icons with fork-tree
   rendering; rename moved out of the ⋯ menu (menu removed).
9. **Workspace row icons**: merge / rename / new session / manage folders /
   delete as direct buttons; the merge action uses a distinct link icon.
10. **Recycle-bin styling**: a workspace-level group row (trash icon, bold
    brand-blue title, expanded by default, click to collapse, items aligned
    with the title).
11. **File preview panel**: clicking a **file** in the sidebar folder tree slides
    a 520px panel in from the right — a header with the file name and full path,
    and a body rendered with the same **Markdown renderer** used for chat
    messages: `.md` files render as Markdown (headings / lists / code blocks /
    tables / links); 30+ code extensions (`.js/.ts/.vue/.json/.java/.py/.xml/
    .yml/.css/.html`…) are wrapped in syntax-highlighted code blocks. Content
    comes from the new `host.readFile` RPC (workspace-root-bounded, ≤256KB,
    binary files refused).
12. **Fixes**: recycle-bin RPC envelope unwrap bug, server default cwd being a
    drive root (`C:\`) which broke ungrouped session creation, and more.

## Installation

Prerequisites: DeepSeek Harness installed (`@deepseek-ai/dsh@0.1.0-rc.6`).

```powershell
# 1. Install the plugin package into the DSH profile (shows up in the plugin inventory)
npm install --prefix "$env:USERPROFILE\.dsh\profiles" dsh-workspace-enhance

# 2. Apply the overlay patch-set (backups are taken automatically)
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.dsh\profiles\node_modules\dsh-workspace-enhance\scripts\install.ps1"

# 3. Restart the DSH server and hard-refresh the GUI (Ctrl+Shift+R)
```

Verify / rollback:

```powershell
powershell -ExecutionPolicy Bypass -File "...\scripts\verify.ps1"    # check patch liveness
powershell -ExecutionPolicy Bypass -File "...\scripts\uninstall.ps1" # restore the latest backup
```

## Terminal (TUI) adaptation

Works with [`@dsh-tui/dsh-tui`](https://github.com/openguardrails/dsh-tui), the
Claude Code-style terminal front door:

```powershell
# 1. Install the TUI into its own profile (needs Node ^22.19 || >=24 and pnpm)
dsh plugin --profile tui add @dsh-tui/dsh-tui

# 2. Install this plugin (declares a dsh.bundle layer, so it joins the profile composition)
dsh plugin --profile tui add github:yuanzehui313/dsh-workspace-enhance

# 3. The tui profile resolves host packages from the dsh CLI install — point the overlay there
powershell -ExecutionPolicy Bypass -File "...\scripts\install.ps1" -TargetRoot "C:\...\node_modules\@deepseek-ai"

# 4. Launch (requires a real terminal)
dsh --profile tui
```

Slash commands available in the terminal (host-registered; the web surface can
use them too):

| Command | Purpose |
|---|---|
| `/trash` | list recycle-bin sessions and workspaces |
| `/trash-restore <id>` | restore a recycle-bin entry |
| `/trash-purge <id>` | permanently delete a recycle-bin entry |
| `/move <sessionId> <workspaceId \| ungrouped>` | move a session to another workspace (or ungroup it) |
| `/preview <path>` | preview a workspace file (Markdown rendering, code files highlighted) |

The web sidebar UI (recycle-bin group, drag-and-drop, preview panel) is web-only;
the TUI drives the same host capabilities through these commands and shares the
same durable state.

## Layout

```
dsh-workspace-enhance/
├── package.json        # standard DSH plugin metadata (dsh.client → lib/client.js)
├── lib/
│   ├── index.js        # host-side Cordis service (inventory visibility + capability marker)
│   └── client.js       # client plugin (standard __ModuleLoader__ form)
├── overlay/            # overlay patch-set mirroring @deepseek-ai relative paths (17 bundles)
├── scripts/            # install / uninstall / verify
└── README.md (Chinese, GitHub default) / README.en.md (English)
```

## Compatibility

Targets `@deepseek-ai/dsh@0.1.0-rc.6` on Windows. After upgrading DSH, re-check
the overlay against the new bundles (`verify.ps1` reports REVERTED).

## License

MIT
