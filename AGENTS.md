<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Projekt "Miasto"

Trwałe reguły projektu są w `.cursor/rules/` (wizja gry, architektura, świat i zapis, zasoby 3D i wydajność, testy). Dokumentacja projektowa etapu 1 jest w `docs/projekt/` (zacznij od `README.md`). Pracuj etapami i zatrzymuj się do zatwierdzenia po każdym większym etapie.

**Zakaz testów w przeglądarce:** nie uruchamiaj przeglądarki ani subagentów `computerUse` i nie wykonuj testów GUI. Wygląd, dźwięk i FPS ocenia wyłącznie autor; agent uruchamia tylko Vitest, lint, typecheck i build (reguła `miasto-wizja.mdc`).
