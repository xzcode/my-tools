# Project guidance

My Tools is a public, MIT-licensed, offline-first personal desktop toolbox built with Tauri 2, Vue 3, TypeScript and Rust.

- Read `docs/HANDOFF.md` before continuing work. Keep completed work, remaining limitations and verification evidence accurate.
- Keep pure transformations in `src/core`, off-main-thread scheduling in the Worker layer, and OS access behind `src/platform/desktop.ts` / Rust commands.
- Do not persist inputs, outputs, HMAC keys, tokens, file bodies or clipboard contents. Persist only explicit preference metadata.
- Preserve AES simple-mode v0.2.0 password-based JSON ciphertext compatibility. The advanced mode uses exact-length raw AES Key and IV for interoperability. Warn against GCM nonce reuse; CBC is unauthenticated and ECB is only supported for legacy Java AES/ECB/PKCS5Padding interoperability (no IV, no authentication). Prefer GCM for new use.
- No implicit network requests, shell execution, clipboard polling or unrestricted filesystem permissions. cURL is a parser, never a request executor.
- Never replace lossless JSON parsing with ordinary `JSON.parse` for user JSON data; long integer precision is part of expected behavior.
- Add a tool through the shared catalogue and implement meaningful boundary checks. Avoid building a second UI framework or duplicate tool registry.
- Prefer focused tests that exercise concrete behavior. Run version checks, existing transformation tests, TypeScript/build checks, and relevant acceptance paths after substantive changes.
- Desktop packaging must use the matching platform runner. Browser tests do not prove native shortcut, tray, clipboard or installer behavior.
- Do not claim signing, notarization, native installation or update verification unless it actually happened.
- Keep package, Cargo and Tauri versions synchronized, and commit lockfiles.
- Do not put signing credentials or access tokens into source code, generated config, logs or documentation.
