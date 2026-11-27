# Toolbox EX

**English** · [简体中文](README.zh-CN.md)

An open-source, offline desktop toolbox for developers, built with **Tauri 2, Vue 3, TypeScript and Rust**. Toolbox EX brings 31 everyday utilities into one local workspace.

No account required. No remote conversion service. Your data stays on your device.

[Releases](https://github.com/xzcode/toolbox-ex/releases) · [Build status](https://github.com/xzcode/toolbox-ex/actions/workflows/desktop.yml) · [User guide](docs/USAGE.md)

## Features

| Tool | Capabilities |
| --- | --- |
| JSON | Format, minify, validate, sort keys, escape/unescape, extract paths and inspect a tree; preserves large integers |
| String joining | Join lines with separators, prefixes, suffixes and quotes; handle empty lines and duplicates |
| Text processing | Deduplicate, sort, replace, normalize whitespace, change case and escape HTML |
| Base64 | UTF-8, URL-safe encoding, padding, hexadecimal byte mode and binary file conversion |
| AES | AES-128/192/256 GCM, CBC and ECB; password-based AES-256-GCM/PBKDF2; Java AES/ECB/PKCS5Padding compatibility, explicit Key/IV, padding, Tag/AAD and literal ciphertext prefixes |
| URL | URI/component encoding and decoding; parse and build query parameters |
| Timestamp | Convert seconds, milliseconds and dates; current time and time zone display |
| UUID and random text | UUID v4 and batch generation using secure randomness |
| Password generator | Secure passwords, character categories and ambiguous-character filtering |
| Hash / HMAC | SHA-256, SHA-512, HMAC, hexadecimal and Base64 output |
| JWT | Inspect headers, payloads and time claims; does not verify signatures |
| SQL | Dialect-aware formatting, IN-clause generation and string escaping |
| Regular expressions | Match, capture and replace; cancellable Worker-based processing |
| Diff | Text and JSON structural comparisons |
| Data conversion | Convert between JSON, YAML and CSV |
| cURL | Parse commands, headers, parameters and bodies locally without executing commands or sending requests |
| Key generation, inspection and conversion | RSA, ECC, SM2, Ed25519/448, X25519/448 and random keys; PEM, DER, JWK and OpenSSH formats; named directories and configurable default storage path |
| Digital signatures | RSA-SHA1/SHA2/SHA3/PSS, ECDSA, SM2-SM3 and EdDSA; sign and verify raw data, parameters or JSON responses |
| Advanced cryptography | RSA OAEP/PKCS1, SM2, SM4-GCM, DES, XChaCha20-Poly1305, BLAKE3, CRC32, PBKDF2, HKDF, scrypt and Argon2id |
| Certificates | X.509 inspection, CSR, self-signed certificates, SAN and explicit local trust-root/hostname validation |
| Key stores | Create, inspect and extract PKCS12/PFX and JKS containers |
| SM2 ciphertext formats | Convert ASN.1, C1C3C2 and C1C2C3 |
| International phone numbers | Search country flags and calling codes, validate numbering plans, display types and E.164 |
| SVGA preview | Local 1.x ZIP and 2.x zlib animation playback, frame controls, progress and looping |

### Workspace

- Independent tabs for every tool, with duplicate, rename, close and restore operations.
- Complete automatic local saving of parameters, keys, prefixes, inputs, outputs, files, templates and history.
- Collapsible right-hand history panel with search, filters, restoration to a new tab and manual cleanup by date.
- Six appearance choices: system, light, soft light, dark, pure black and gray. The selected theme is remembered.
- Favorites, recent tools, quick launcher, explicit clipboard actions, file import/export and batch processing.

Ordinary workspaces, history and files are not subject to fixed count or storage quotas. Practical capacity depends on memory and disk space. Format-specific validation and protection against malformed archives remain in place.

### Compatibility and limitations

Native cryptographic operations run in the installed desktop application using bundled OpenSSL and supporting Rust libraries. The browser preview is intended for interface testing.

AES's simple mode retains its existing authenticated JSON format. Advanced mode interoperates with Java, Node.js and Python when algorithm parameters match. A ciphertext prefix is appended after encoding and matched literally before decryption. ECB, CBC, RSA-SHA1 and other legacy algorithms are intended for compatibility; prefer authenticated encryption for new designs, and never reuse a GCM nonce with the same key.

OpenSSH conversion currently supports RSA and Ed25519; JKS alias and password support is limited to ASCII. Certificate validation uses explicitly supplied local trust roots without online revocation checks. Phone validation checks numbering plans, not whether a number is active. SVGA audio is not supported.

See the [cryptography guide](docs/CRYPTO_TOOLS.md) for details.

## Download

| Platform | Package |
| --- | --- |
| macOS Apple Silicon | `.dmg` (ARM64) |
| Windows x64 | NSIS `.exe` installer |
| Linux x64 | `.deb` built on Ubuntu 24.04 |

Visit [Releases](https://github.com/xzcode/toolbox-ex/releases) and check the corresponding [Desktop builds](https://github.com/xzcode/toolbox-ex/actions/workflows/desktop.yml) run. Download the installer and its platform SHA-256 checksum file.

Builds are uploaded to draft releases. Drafts are accessible to accounts with release-management permission; public downloads become available when a maintainer publishes the release. The workflow does not automatically publish drafts.

macOS builds use ad-hoc signing by default and are not Apple-notarized. Windows installers are not commercially code-signed by default. Linux compatibility outside the build distribution depends on system libraries. See [building and releasing](docs/RELEASING.md).

## Local development

Requirements: Node.js 22.14+, stable Rust and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). Windows builds also require native Perl for vendored OpenSSL.

```bash
git clone https://github.com/xzcode/toolbox-ex.git
cd toolbox-ex
npm ci
npm run desktop:dev
```

For browser-based UI development, run `npm run dev`.

```bash
npm run check
npx playwright install chromium
npm run test:e2e
cargo test --manifest-path src-tauri/crypto-core/Cargo.toml --locked
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run desktop:build
```

Java 21 is used for independent cryptographic interoperability tests. Browser tests do not replace native installer, tray or shortcut verification.

## Project structure

```text
src/core/          Tool registry and pure TypeScript transformations
src/components/    Editors, tool interfaces and workspace panels
src/composables/   Workspace state and task scheduling
src/workers/       Background transformations
src/platform/      Desktop IPC and browser adapters
src-tauri/         Rust desktop application and native cryptography
tests/             Core tests and browser acceptance tests
scripts/           Build, release and checksum tooling
docs/              Usage, architecture and development documentation
```

## Local data and privacy

All workspace content is saved automatically on the device. New desktop archives use authenticated encryption with an automatically generated local key; existing credential-store-protected archives retain their original protection. Local encryption is not a defense against software that already controls the device. Users manage and delete their own history and sensitive data.

Toolbox EX was previously named My Tools. The existing application identifier, preference and workspace formats, and AES ciphertext identifiers remain unchanged for compatibility. Existing configured key directories are preserved. Data discarded by earlier save policies cannot be reconstructed.

Clipboard access is explicit. File access is scoped to user-selected or dropped files. Tools do not upload content, and optional network updates are disabled in default builds.

## Documentation

The detailed guides are currently available in Chinese: [Usage](docs/USAGE.md), [Architecture](docs/ARCHITECTURE.md), [Desktop integration](docs/DESKTOP.md), [Cryptography](docs/CRYPTO_TOOLS.md), [Releasing](docs/RELEASING.md), [Release notes](docs/RELEASE_NOTES.md) and [Development handoff](docs/HANDOFF.md).

## License

Released under the [MIT License](LICENSE). Copyright © 2026 xzcode. Dependencies retain their own licenses.
