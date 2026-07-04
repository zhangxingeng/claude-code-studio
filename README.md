# Deck — Claude Code Control Center

The friendly home for [Claude Code](https://claude.com/claude-code) — browse, configure, and run it without living in the terminal.

**Offline** · **Your data never leaves your machine** · **Open source, MIT licensed**

![Deck — a session rendered as a clean conversation with version diffs and the save bar](docs/hero.png)

<!-- TODO: capture a short demo GIF walking session → settings edit → launch, and drop it here. -->

## Why Deck exists

Coding is becoming something everyone can do — not just people who are comfortable in a terminal reading raw JSON. Claude Code is extraordinarily capable, but two things stand between it and a much wider audience: **the command line**, and **a settings system spread across nested JSON files that even experienced developers lose track of.**

Deck exists to remove that wall. It's built on one rule: **simple by default, advanced on demand.** The common things — reading a past session, changing a setting, starting a new one — are a click away and explained in plain language. The power-user knobs are all still there; they're just not in your way until you go looking for them.

## Is this for you?

- **You like a GUI more than a terminal.** You want to browse and search your Claude Code history, tweak settings, and launch sessions without memorizing flags or hand-editing JSON.
- **You're new to coding with Claude Code.** You don't need to know what a `.jsonl` file is or where `settings.json` lives. Deck shows you what's there and explains it as you go.

Either way, Deck reads and writes the same files Claude Code already uses — nothing proprietary, nothing locked in.

## What it does

### See everything
Auto-discovers every Claude Code session on your machine and renders it as a clean, readable conversation — markdown, collapsible thinking, tool calls and results, nested subagent threads — instead of raw JSON. Full-text search across your entire history, with filters for source, date, and project. Edit in place, track every version with a word-level diff, and restore any backup in one click.

### Config without the JSON
Claude Code settings live in up to three files — user (`~/.claude/settings.json`), project (`.claude/settings.json`), and local (`.claude/settings.local.json`) — and it's genuinely hard to know what's set where, or which one wins. Deck reads all three, shows each field with a plain-language explanation (pulled from Claude Code's own published schema), and flags conflicts loudly: *"`model` is set in both User and Project — Project wins."* Edit any tier directly; Deck writes exactly the file you meant to change.

### Run it your way
Deck doesn't force its own console. Launch Claude Code in whatever terminal you already use — it auto-detects a sensible default so it just works. If you want more control, an advanced panel lets you pick a specific terminal and pass extra arguments (e.g. `--dangerously-skip-permissions`), clearly labeled and never in the way of the default path.

## Getting started

Deck is a companion to Claude Code, not a replacement for it — you'll need [Claude Code installed](https://code.claude.com/docs/en/quickstart) first. Once it's set up, Deck finds your sessions and settings automatically.

Download the installer for your platform from the [Releases page](https://github.com/zhangxingeng/deck/releases):

| Platform | Files |
|----------|-------|
| Windows  | `.exe` or `.msi` |
| macOS    | `.dmg` (Apple Silicon and Intel) |
| Linux    | `.AppImage` or `.deb` |

### First launch (unsigned builds)

These builds aren't code-signed — certificates are a paid, per-platform expense — so your OS may warn you the first time you open the app:

- **Windows** — SmartScreen: click **More info** → **Run anyway**.
- **macOS** — Right-click the app → **Open** → confirm (or System Settings → Privacy & Security → Open Anyway).
- **Linux** — For the AppImage, run `chmod +x <file>.AppImage` first.

## Privacy / how it works

Deck runs entirely on your local filesystem. It reads and writes the same session and settings files Claude Code already uses under `~/.claude/`; nothing is uploaded anywhere. The only network request it ever makes is checking for its own updates.

## For developers

Deck is a Tauri v2 + Svelte 5 desktop app. Build from source:

Requires [Node.js](https://nodejs.org), [Rust](https://rust-lang.org), and the [Tauri v2 prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
pnpm install
pnpm tauri build
```

Curious how it works or want to contribute? See [ARCHITECTURE.md](ARCHITECTURE.md).

## FAQ

**Does Deck send my conversations anywhere?** No. Everything happens locally; the only network call is the update checker.

**Does Deck replace Claude Code?** No — it's a control center *for* Claude Code. You still need Claude Code installed; Deck makes it easier to see, configure, and launch.

**Will editing settings in Deck break something?** Deck writes exactly the tier you edit, in the same JSON format Claude Code reads — nothing is merged behind your back, and conflicts across tiers are called out before you save.

## License

MIT

---

*Deck is an independent, unofficial project. It is not affiliated with, endorsed by, or sponsored by Anthropic. Claude and Claude Code are trademarks of Anthropic, PBC.*
