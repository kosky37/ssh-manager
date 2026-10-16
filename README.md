# SSH Manager

Desktop app for managing remote Linux hosts over SSH.

## Features

- **Terminal** — interactive SSH shell (defaults to `sudo -i` for non-root users; uses the stored password when prompted)
- **Docker** — list containers, CPU/memory stats, logs, start/stop/restart/remove
- **Tailscale** — detect/install/update, view version & status, basic `tailscale set` / up / down
- **Resources** — CPU, memory, swap, disk, top processes
- **Files** — browse filesystem, chmod/chown, upload & download via SFTP

## Auth

Supports password login and private key (optional passphrase).

Servers are configured in `servers.json` (gitignored). See `servers.example.json`.

Your existing credentials under `ssh keys/` are already wired into a local `servers.json`.

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Notes

- `servers.json` and `ssh keys/` are gitignored — do not commit secrets.
- Hostnames like `home-nas` / `nas` must resolve on your machine (DNS, hosts file, or Tailscale MagicDNS).
- For non-root accounts, Docker and terminal elevation use `sudo` by default and try the stored SSH password (`sudo -S` / interactive prompt). Use **Connect as user** if you want an unprivileged shell.
