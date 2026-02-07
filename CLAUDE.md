# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Meet Transcriber is a browser extension built with WXT (Web Extension Tools) and React for transcribing meetings.

## Commands

```bash
# Development (Chrome)
pnpm dev

# Development (Firefox)
pnpm dev:firefox

# Build for production
pnpm build
pnpm build:firefox

# Package as zip
pnpm zip
pnpm zip:firefox

# Type check
pnpm compile
```

## Architecture

This is a WXT browser extension using the React module. WXT provides auto-imports for extension APIs (`browser`, `defineBackground`, `defineContentScript`).

### Entry Points (`entrypoints/`)

- **background.ts** - Service worker for extension background logic
- **content.ts** - Content script injected into web pages (currently matches `*://*.google.com/*`)
- **popup/** - React-based popup UI shown when clicking the extension icon

### Key Conventions

- WXT auto-generates types in `.wxt/` directory
- Use `@/` path alias for imports from project root (e.g., `@/assets/`)
- Content scripts define their URL match patterns via `defineContentScript({ matches: [...] })`
