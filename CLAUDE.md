# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenClaw plugin for 若叶睦「楚门的世界」— a data-driven world simulation engine for the Mutsumi QQ bot. Code handles physics (routes, coordinates, NPC positions); the DM LLM (DeepSeek) handles narrative (environment, events, encounters). `world.json` is the core state blackboard with `_dm` (LLM read/write) and `_mutsumi` (bot read-only) sections.

## Build & Test

```bash
npm run build                # tsc → dist/
npm run build -- --watch     # dev mode
npx tsx --test tests/*.test.ts             # all tests (26 across 6 suites)
npx tsx --test tests/world-state.test.ts    # single unit suite
npx tsx --test tests/integration.test.ts    # real DeepSeek DM tests (skipped without DEEPSEEK_API_KEY)
```

Unit tests (22) cover simulation engines. Integration tests (4) exercise the full DM pipeline with real DeepSeek API calls and are auto-skipped in CI.

## Architecture

```
src/types.ts          — all 25+ interfaces (WorldState, Position, RouteResult, NPCState, TickContext…)
src/data-loader.ts    — loads 7 JSON files from data/; installDataFiles() copies to workspace on first run
src/world-state.ts    — world.json atomic read/write (.tmp → rename); createEmptyWorld(); appendTrajectory()
src/map-engine.ts     — Dijkstra shortest path on road network; coordinate interpolation; distance-based position advancement
src/schedule-engine.ts — expands template + class_timetable → full daily segments; getDayType(); findCurrentSegment()
src/npc-engine.ts     — computes NPC positions from schedules (location or traveling with progress)
src/llm-client.ts     — DeepSeek API client (OpenAI-compatible /v1/chat/completions); dmChat() accumulates messages across ticks; complete() for one-shot (diary)
src/dm-session.ts     — core engine: tick scheduler (10min, 07:00-23:00), morning routine, DM prompt builder, response handler, crash recovery
src/tools.ts          — 4 OpenClaw tools: world_status, check_schedule, observe_surroundings, move_to
src/diary.ts          — nightly diary via LLM; parses real OpenClaw trajectory.jsonl (prompt.submitted / model.completed entries); dual-writes to ~/.openclaw/workspace/memory/ + repo
src/logger.ts         — file logger + forwards to OpenClaw logger
src/index.ts          — plugin entry: installDataFiles → startDMScheduler → registerTools → scheduleDiary
```

**Dependency graph:** `types.ts` and `data-loader.ts` are leaves. `world-state.ts`, `map-engine.ts`, `schedule-engine.ts`, `llm-client.ts` depend only on types. `npc-engine.ts` depends on `map-engine.ts`. `dm-session.ts` depends on everything. `tools.ts` and `diary.ts` depend on `dm-session.ts`/`world-state.ts`. `index.ts` wires it all.

## Key Constraints

| Constraint | Value |
|---|---|
| Walking speed | 1.2 m/s |
| Tick interval | 10 min (07:00-23:00 only) |
| Max events/day | 2-3 new, ≤3 concurrent |
| world.json write | `.tmp` then `rename` (atomic) |
| Trajectory | facts only, no feelings |
| Never modify | `SOUL.md`, `garden.md`, `inventory.md`, `funny-log.md` |

## Configuration

- **API key:** `DEEPSEEK_API_KEY` env var (User-level, set via `[Environment]::SetEnvironmentVariable`)
- **Model:** `deepseek-v4-flash`, base URL `https://api.deepseek.com`
- Override via `createLLMClient({ apiKey, baseUrl, model })`

## Data Files (`data/`)

`locations.json`, `road_network.json`, `schedule.json`, `weather.json`, `events.json`, `npcs.json`, `rules.json`. On first install, `installDataFiles()` copies them to `~/.openclaw/workspace/game/` (skips if already exists — user edits are preserved).

## Runtime Files (in repo root)

- `world.json` — live simulation state
- `mutsumi-world.log` — structured log (`[YYYY-MM-DD HH:MM:SS] LEVEL Message`)
- `diaries/YYYY-MM-DD.md` — generated daily diaries

## Installation

Plugin is symlinked: `~/.openclaw/extensions/openclaw-mutsumi-world` → repo root.
Enabled via `plugins.entries.openclaw-mutsumi-world` in `~/.openclaw/openclaw.json`.
Restart Gateway to load: `openclaw gateway stop && openclaw gateway start`.

## Diary Chat Log Parsing

Diary reads `~/.openclaw/agents/main/sessions/*.trajectory.jsonl` (including `.jsonl.reset.*` backups). Actual trajectory format uses `prompt.submitted` (user input, field `data.prompt`) and `model.completed` (assistant response, field `data.assistantTexts[]`), filtered by `ts` timestamp. Do NOT look for `type: "message"` — that format does not exist in OpenClaw trajectories.
