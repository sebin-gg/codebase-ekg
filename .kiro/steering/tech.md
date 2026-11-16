---
inclusion: always
---

# Tech stack and constraints

- Node.js >= 22.18 runs TypeScript directly via native type stripping. There is no build step for
  the server and no runtime dependencies. Keep it that way.
- Because of type stripping, all TypeScript must be erasable syntax only (`erasableSyntaxOnly`):
  no `enum`, no `namespace`, no constructor parameter properties. Use `import type` for types and
  always import local files with the `.ts` extension.
- Frontend: vanilla TypeScript + Canvas 2D + Web Audio, bundled by Vite. No UI framework.
- Server: `node:http` only. Server-Sent Events for live readings. In dev, Vite runs in middleware
  mode inside the same process; in production the server serves `dist/`.
- Tests: Vitest + fast-check. Pure logic gets property-based tests; IO gets unit tests with fakes
  (GitHub) or a real temporary git repo (local).
- Package manager: pnpm. New dependencies must be at least 7 days old (`minimumReleaseAge`).

## Commands

- `pnpm dev`: dev server on http://127.0.0.1:1313 with HMR
- `pnpm check`: typecheck + all tests (run before declaring any task done)
- `pnpm build && pnpm start`: production build and server

## Security rules

- Bind to 127.0.0.1 by default and reject non-loopback Host headers (DNS rebinding).
- Never pass request input to a shell. Git runs through `execFile` with argument arrays.
- Local admissions are disabled when bound to a public interface unless `EKG_ALLOW_LOCAL=1`.
- `EKG_TEST_CMD` comes from the operator's environment only, never from a request.
- Never log or echo `GITHUB_TOKEN`.
