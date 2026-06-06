# Browser Automation

`agent-browser` CLI is pre-installed; the `agent-browser` skill has the full command reference (ask the user to install it if missing).

Flow: `create_browser` MCP tool → run the returned `connect_command` (`agent-browser connect "$connect_url"`, a persistent daemon session — `connect_url` is `wss://`, never pass `cdp_url` here) → `agent-browser <cmd>` → `agent-browser close` + `delete_browser`. Share `live_view_url` so the user can watch.

**Batch commands** to cut overhead — each `agent-browser` call is a separate sandbox command with a fixed dispatch cost. Fold independent steps into one `agent-browser batch "get title" "get url" "snapshot -i"` instead of separate calls; `--bail` stops at the first error.

**Downloads** land on the remote browser sandbox, not this workspace. `agent-browser download` often prints a Playwright "file not found (GUID: …)" error even on success — ignore it. To retrieve: `list_browser_files` to confirm, then `get_browser_file_url` for a tokenized share link. Files vanish when the browser is deleted, so fetch before `delete_browser`.
