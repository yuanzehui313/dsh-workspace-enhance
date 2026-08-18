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
9. **Workspace row icons**: merge / rename / new session / delete as direct
   buttons; the merge action uses a distinct link icon. (The “manage folders”
   icon was removed — its entry point is now the + button on the folder/file
   area headers.)
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
13. **Folder area / file area sections**: each workspace group renders two
    distinct sections — the folder area (blue tint; primary folder + all
    additional folders, primary not removable) on top and the file area
    (purple tint; public files or an empty hint) below; both headers collapse
    on click and keep their place when empty; the Ungrouped section renders
    neither.
14. **Multi-select file/folder picker**: the + button on either section header
    opens the in-app multi-select browser (drive-level entry, folders navigate,
    checkboxes multi-select across directories, 320px scrolling list); confirm
    routes folders into the folder area and files into the file area; cancel
    returns straight to the page.
15. **Session files**: files pasted (Ctrl+V) into a conversation are uploaded
    through `workspace.importFiles` into the workspace's `.dsh-uploads/` and
    mounted above the owning session row (green block with a left accent bar;
    header shows "Session files · N files · session title"); the block
    collapses on click, file rows have an always-visible × and click-to-preview.
16. **Unrestricted attachments**: any file format can be pasted/dropped as an
    attachment (the four image types still ride the image pipeline); binary
    sends only a `[附件 name]` marker; chips show an extension badge + file
    name; size caps apply only to content-bearing images and text.
17. **Drag-drop upload**: drop files onto the file area (dashed highlight) —
    they are persisted via `workspace.importFiles` to `.dsh-uploads/`
    (auto-numbered on collision, ≤5MB each) and listed immediately; click a
    file row to preview.
18. **Preview upgrade**: public/session file rows and folder-tree files all
    open the preview panel; `host.readFile` returns base64 for binary files and
    the panel renders png/jpg/jpeg/gif/webp/svg images inline; Markdown and
    30+ code languages as before.

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

## Patch persistence

- The overlay installs with delete-then-copy, **breaking hardlinks with the
  official packages** — a DSH host relaunch through `npx -y @deepseek-ai/dsh web`
  re-fetches official bundles without clobbering the patched files.
- The web surface resolves plugins from the **profile's `node_modules\@deepseek-ai`**
  (that is where the overlay lands).
- After upgrading DSH, re-check the overlay (`verify.ps1` reports REVERTED).

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
