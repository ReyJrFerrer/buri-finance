<img src="build/icon.png" alt="Buri Finance icon" width="128" />

# Buri Finance

A local-first personal finance desktop app for macOS and Windows: budgeting, double-entry bookkeeping, investment tracking, and net-worth tracking. Your data stays on your machine.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```

The macOS command packages the Electron distribution already installed by `npm install`,
avoiding a second large download during packaging. Run it on macOS for the installed
Electron architecture (arm64 on Apple Silicon). For another architecture, use
`npm run build && npx electron-builder --mac --x64` (or `--arm64`); this downloads
the matching distribution instead.

Do not copy the macOS `electronDist` override to Windows or Linux builds on a Mac:
the installed distribution is the macOS runtime, which cannot be packaged for Windows
or Linux. Those commands download the target platform's Electron distribution.
For a usable Windows installer, build on Windows after a fresh `npm ci`: the app
includes native SQLite code and `npmRebuild: false`, so a Mac installation's native
module cannot be reused on Windows. Select the target explicitly when needed with
`npm run build:win -- --x64` or `npm run build:win -- --arm64`, using matching
Windows Node/Electron installations.

If packaging reports `Timeout awaiting 'request' for 600000ms` while downloading
an Electron zip, the download exceeded ten minutes. This is a packaging download
failure. `npm run build` compiles the app without downloading Electron.
The project currently configures `npmmirror.com` in both `electron-builder.yml`
and `.npmrc`; changing only one does not change both packaging and installation.
The macOS command avoids the Electron zip download, but packaging tools may still
need network access on their first use.
