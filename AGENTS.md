# Project guidance

My Tools is a public, MIT-licensed, offline-first personal desktop toolbox built with Tauri 2, Vue 3, TypeScript and Rust.

- Read `docs/HANDOFF.md` before continuing work. Keep completed work, remaining limitations and verification evidence accurate.
- Keep pure transformations in `src/core`, off-main-thread scheduling in the Worker layer, and OS access behind `src/platform/desktop.ts` / Rust commands.
- All tool parameters, input/output, files, templates and history are saved automatically in the complete local workspace. Do not filter fields or automatically prune history; cleanup is user-controlled. New workspaces use an app-local random key with authenticated encryption; old OS-keychain vaults retain their original protection. Do not automatically overwrite an unreadable vault or upload content.
- Preserve AES simple-mode v0.2.0 password-based JSON ciphertext compatibility. The advanced mode uses exact-length raw AES Key and IV for interoperability. Warn against GCM nonce reuse; CBC is unauthenticated and ECB is only supported for legacy Java AES/ECB/PKCS5Padding interoperability (no IV, no authentication). Prefer GCM for new use.
- No implicit network requests, shell execution, clipboard polling or unrestricted filesystem permissions. cURL is a parser, never a request executor.
- Never replace lossless JSON parsing with ordinary `JSON.parse` for user JSON data; long integer precision is part of expected behavior.
- Add a tool through the shared catalogue and implement meaningful boundary checks. Avoid building a second UI framework or duplicate tool registry.
- Prefer focused tests that exercise concrete behavior. Run version checks, existing transformation tests, TypeScript/build checks, and relevant acceptance paths after substantive changes.
- Desktop packaging must use the matching platform runner. Browser tests do not prove native shortcut, tray, clipboard or installer behavior.
- Do not claim signing, notarization, native installation or update verification unless it actually happened.
- Keep package, Cargo and Tauri versions synchronized, and commit lockfiles.
- Do not put signing credentials or access tokens into source code, generated config, logs or documentation.

- New native cryptography operations use src-tauri/crypto-core and narrowly scoped Tauri commands. Keep user-chosen key directories independent from session history; never overwrite named key directories automatically. No arbitrary workspace or key-count quotas. Signature validation does not establish business or payment validity.
