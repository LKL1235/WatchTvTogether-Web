# AGENTS.md

## Cursor Cloud specific instructions

This is a **Vue 3 + Vite + TypeScript** frontend SPA for a "watch together" room-based video platform. The backend (Go API) is deployed externally on Vercel.

### Quick reference (standard commands in `package.json`)

| Task | Command |
|------|---------|
| Dev server | `npm run dev` (Vite, port 5173) |
| Type check | `npx vue-tsc --noEmit` |
| Tests | `npm test` (Vitest) |
| Production build | `npm run build` |
| Preview build | `npm run preview` |

### Important notes

- The Vite dev server proxy (`/api` → `127.0.0.1:8080`) is only useful when running the Go backend locally. Without a local backend, the frontend uses `VITE_API_BASE` (defaults to `https://watchtvtogether.bestlkl.top`). To develop against the remote backend, start the server with:
  ```
  VITE_API_BASE=https://watchtvtogether.bestlkl.top npm run dev
  ```
- There is no linter (ESLint) configured in this project; type checking via `vue-tsc --noEmit` serves as the primary static analysis.
- All 18 tests pass quickly (~250ms). Tests are unit-level and do not require network or backend access.
- The build produces a single-page app in `dist/`; Vercel handles deployment via `vercel.json` rewrites.
- No `.env` file is committed; `VITE_API_BASE` is the only frontend env var.
