# Security Policy

## Reporting a vulnerability

Please do not publish exploit details in a public issue before a fix is available.

If you find a security issue, report it privately through GitHub's private vulnerability reporting feature when available for this repository. Include:

- affected ImgReady version,
- reproduction steps,
- expected and observed behavior,
- security impact,
- any proof-of-concept input needed to reproduce the issue.

## Security boundaries

ImgReady treats remote image URLs and downloaded bytes as untrusted input. The plugin is designed to reduce SSRF, unsafe redirect, path traversal, file-type confusion, oversized-download, and image-dimension abuse risks.

ImgReady does not execute downloaded content. It intentionally rejects SVG in the current release.
