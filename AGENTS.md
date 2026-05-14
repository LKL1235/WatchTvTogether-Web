# AGENTS.md

## Cursor Cloud specific instructions

See the sibling repo `WatchTvTogether/AGENTS.md` for full backend + frontend setup details.

### Frontend (this repo)

- **Run**: `VITE_API_BASE="" npm run dev` — Vite dev server on `:5173`, proxies `/api` and `/static` to the Go backend at `localhost:8080`.
- **Critical**: Always set `VITE_API_BASE=""` for local dev. Without it, the app defaults to the production API (`https://watchtvtogether.bestlkl.top`).
- **Lint**: `npx vue-tsc --noEmit`
- **Test**: `npm run test` (vitest, 18 tests)
- **Build**: `npm run build` (runs `vue-tsc --noEmit && vite build`)
- **Package manager**: npm (lockfile: `package-lock.json`)
