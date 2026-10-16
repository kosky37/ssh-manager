# SSH Manager

Desktop app for managing remote Linux hosts over SSH.

## Download

Grab the latest Windows build from [Releases](https://github.com/kosky37/ssh-manager/releases):

- `SSH-Manager-Setup-x.y.z.exe` — installer
- `SSH-Manager-x.y.z-portable.exe` — single portable executable

## Features

- **Servers** — add, edit, duplicate, reorder (drag & drop) and delete hosts from the UI, test a connection before saving, search with `Ctrl+Shift+K`
- **Terminal** — multiple tabs per server that stay alive when switching tabs or servers; optional root shells (`sudo -i`, answered with the saved password); copy/paste, right-click copy/paste, find (`Ctrl+Shift+F`), font zoom (`Ctrl+=` / `Ctrl+-`)
- **Files** — SFTP browser with breadcrumbs, back/forward history, filter, hidden-file toggle, sortable columns, rename, new file/folder, copy/cut/paste, chmod/chown, drag & drop upload/download, "open terminal here"
- **Docker** — containers with CPU/memory stats, start/stop/restart/remove, logs, one-click shell or live log follow in a terminal tab, clickable published ports
- **Resources** — CPU, load, memory, swap and disk usage with meters, top processes, configurable auto-refresh
- **Tailscale** — install/update, up/down, toggle accept-routes / DNS / SSH / exit node, peer list

Press `F1` in the app for all keyboard shortcuts.

## Configuration

Servers are stored in `%APPDATA%\ssh-manager\servers.json`. Passwords and key passphrases are encrypted with Windows DPAPI (Electron `safeStorage`).

On first launch an existing `servers.json` in the working directory is imported automatically; you can also use **⋯ → Import servers…** with a file shaped like `servers.example.json`.

## Development

```bash
bun install
bun run dev
```

```bash
bun run typecheck
bun run dist:win
```

## Releasing

Push a version tag and GitHub Actions builds the Windows installer and portable exe and publishes them as a release:

```bash
git tag v1.2.3
git push origin v1.2.3
```

The version in the build is taken from the tag.

## Notes

- `servers.json` and `ssh keys/` are gitignored — do not commit secrets.
- Hostnames must resolve on your machine (DNS, hosts file, or Tailscale MagicDNS).
- For non-root accounts, Docker, Tailscale and root terminals use `sudo` with the stored password.
