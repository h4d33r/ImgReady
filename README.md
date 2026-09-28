# ImgReady

ImgReady is a security-first Obsidian desktop plugin that localizes remote raster images into your vault only when you explicitly ask it to.

## What it does

- Scans the active Markdown note and counts local and remote images.
- Shows the exact remote hosts before any download occurs.
- Requires exact-host trust before localization.
- Downloads only on explicit user action.
- Stores downloaded images under a configurable vault folder, grouped by note name.
- Updates matching Markdown/HTML image URLs after successful localization.

## Security model

ImgReady is intentionally conservative:

- HTTPS only.
- Standard HTTPS port 443 only by default.
- Exact-host allowlist; subdomains are not trusted automatically.
- Blocks localhost, single-label/internal hostnames, private/link-local/reserved IP ranges, unsafe IPv6 ranges, and suspicious internal suffixes.
- Resolves DNS before connecting, rejects a hostname if any returned address is unsafe, and pins the connection to the validated address to reduce DNS-rebinding risk.
- Rejects redirects so the plugin cannot silently contact an unreviewed host.
- Accepts PNG, JPEG, GIF, and WebP only. SVG and arbitrary file types are rejected.
- Requires the HTTP MIME type and file signature to agree.
- Validates image dimensions and enforces per-file, per-batch, image-count, and request-time limits.
- Writes attachments through Obsidian's Vault API.
- Validates attachment paths and blocks absolute, traversal, hidden, config-folder, and Windows-reserved paths.
- Never overwrites an existing attachment.
- No telemetry, analytics, or background network traffic.

ImgReady reduces common SSRF and unsafe-download risks, but no image downloader can guarantee that arbitrary image bytes are vulnerability-free for every decoder or operating system.

## Network-use disclosure

ImgReady makes outbound network requests only after the user chooses to localize remote images in the active note. Requests are sent only to exact trusted hosts that pass the security checks. ImgReady does not contact analytics, advertising, telemetry, or update services.

## Local testing

Copy the built release files into:

```text
<YourVault>/.obsidian/plugins/imgready/
```

Required runtime files:

```text
main.js
manifest.json
styles.css
```

Restart Obsidian and enable **ImgReady** under **Settings → Community plugins**. Use a disposable/test vault while evaluating development builds.

## Development

Requirements: Node.js and npm.

```bash
npm install
npm test
npm run build
```

`npm run build` produces the bundled `main.js` that Obsidian loads.

## Current scope

Version 0.1.2 focuses on safe remote-image localization and settings. Orphan cleanup, attachment reorganization, deduplication, mobile support, and broader image syntax handling are intentionally deferred.

## License

MIT
