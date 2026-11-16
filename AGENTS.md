# Agent notes

Project context, conventions and the clinical mapping live in `.kiro/steering/` (read all of it
first); the spec is in `.kiro/specs/codebase-ekg/`.

- Verify with `pnpm check` (tsc + vitest). Run `pnpm build` after UI changes.
- Dev server: `pnpm dev` on http://127.0.0.1:1313 (Vite runs inside the Node server).
- TypeScript is executed by Node's type stripping: erasable syntax only, `.ts` import extensions.
- Package commands go through `sfw pnpm ...` on this machine.
