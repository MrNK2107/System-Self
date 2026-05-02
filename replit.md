# SYSTEM // SELF — Life Operating System

## Overview

pnpm workspace monorepo using TypeScript. A dark, anime-inspired Life Operating System mobile app (Expo/React Native) with AI-powered briefings via Claude.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Mobile**: Expo (React Native) with expo-router
- **AI**: Anthropic Claude (claude-sonnet-4-6) via `@workspace/integrations-anthropic-ai`

## Artifacts

### `artifacts/system-self` (Expo mobile app)
- Dark theme (#111318 background, cold charcoal palette)
- 4 stat domains: BODY, MIND, WEALTH, DISCIPLINE
- Rank system: E → D → C → B → A → S
- AI-powered morning briefings and nightly debriefs via Claude
- AI quest generation (daily + weekly)
- Shadow Self mechanic (divergence tracking)
- Silent rivals with score comparison
- AsyncStorage-based persistence (no backend DB needed for user data)
- Full onboarding flow (5 screens: intro → assessment → identity → calibrating → schedule)
- 5 tabs: Dashboard, Log, Quests, Stats, Rivals

### `artifacts/api-server` (Express API)
- `POST /api/system/message` — AI persona messages (morning briefing, nightly debrief, etc.)
- `POST /api/system/quests` — AI quest generation
- Uses Anthropic integration (`@workspace/integrations-anthropic-ai`)

## Key Architecture Notes

- Frontend does NOT use `@workspace/api-client-react` hooks (Metro bundler can't resolve generated files easily). Uses direct `fetch()` calls in `hooks/useSystemAI.ts` instead.
- `EXPO_PUBLIC_DOMAIN` env var determines the API base URL at runtime
- Colors: background `#111318`, card `#1A1D24`, primary `#3A7BD5`, border `#2A2D38`
- Domain colors: BODY `#E05555`, MIND `#3A7BD5`, WEALTH `#4B8B6F`, DISCIPLINE `#C4873A`
- Rank colors: E `#6B7280`, D `#4B8B6F`, C `#3A7BD5`, B `#7C5CBF`
- SpaceMono font referenced in some components — falls back gracefully (not installed via package)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
