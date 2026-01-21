# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a monorepo containing TypeScript/JavaScript libraries and configuration presets published under the `@gpahal` scope. It uses pnpm workspaces, Turborepo for build orchestration, and follows a consistent structure across all packages.

## Build System

### Package Manager

- Uses **pnpm** (v10.28.1+) with workspaces
- All packages are in `packages/` directory
- Use `pnpm` for all package management operations

### Build & Development Commands

```bash
# Install dependencies
pnpm install

# Build all packages (uses Turborepo)
pnpm build

# Build with turbo directly for more control
turbo run build

# Run tests across all packages
pnpm test
turbo run test

# Lint entire codebase
pnpm lint                # Run all linters (eslint + stylelint)
pnpm lint:eslint         # ESLint only
pnpm lint:stylelint      # Stylelint only
pnpm lint-fix            # Auto-fix all linting issues

# Format code
pnpm fmt                 # Format all code
pnpm fmt-check           # Check formatting without writing

# Clean build artifacts
pnpm clean               # Clean all packages + turbo cache
turbo run clean          # Clean individual packages only
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests for a specific package
cd packages/<package-name>
pnpm test

# Watch mode for development
cd packages/<package-name>
vitest
```

### Git Hooks

- Pre-push hook runs: lint, format check, build, and verifies no git changes
- Configured via `simple-git-hooks` in `.simple-git-hooks.json`

## Architecture

### Monorepo Structure

```txt
jslib/
├── packages/              # All publishable packages
│   ├── tsconfig/         # TypeScript configuration presets
│   ├── eslint-config/    # ESLint configuration presets
│   ├── prettier-config/  # Prettier configuration presets
│   ├── stylelint-config/ # Stylelint configuration presets
│   ├── std/              # Standard library utilities
│   ├── std-node/         # Node.js-specific utilities
│   ├── logger/           # Winston-based logger
│   ├── image/            # Image utilities
│   ├── image-node/       # Node.js-specific image utilities
│   ├── og-image/         # OG image generation (Satori-based)
│   ├── font/             # Font utilities
│   ├── font-fallback/    # Font fallback generation
│   ├── remark-preset-lint/ # Markdown linting preset
│   ├── tailwindcss-color-themes/ # Tailwind CSS color theme plugin
│   └── tailwindcss-variants/      # Tailwind CSS variants plugin
├── config/               # Shared configuration files
│   ├── tsconfig.base.json
│   ├── tsconfig.build.base.json
│   ├── tsup.base.config.ts
│   └── vitest.base.config.ts
└── turbo.json           # Turborepo configuration
```

### Package Categories

1. **Config Presets**: Shareable configurations for TypeScript, ESLint, Prettier, Stylelint
2. **Standard Libraries**: `std` (browser-safe utilities), `std-node` (Node.js-specific), `logger`
3. **Image Utilities**: `image`, `image-node`, `og-image` (with Satori for React-based OG images)
4. **Font Utilities**: `font`, `font-fallback`
5. **Tailwind Plugins**: `tailwindcss-color-themes`, `tailwindcss-variants`
6. **Markdown Tools**: `remark-preset-lint`

### Package Structure

Each package follows a consistent structure:

```txt
packages/<name>/
├── src/                 # Source TypeScript files
├── build/               # Compiled output (generated)
├── tests/               # Test files (*.test.ts)
├── package.json
├── tsconfig.json        # Development config (extends base)
├── tsconfig.build.json  # Build config (stricter)
└── README.md
```

### Build Configuration

**TypeScript**:

- Base config: `config/tsconfig.base.json`
- Build config: `config/tsconfig.build.base.json`
- Each package has:
  - `tsconfig.json` - for development/IDE (extends base + vitest)
  - `tsconfig.build.json` - for production builds (stricter)

**Build Tool (tsup)**:

- Shared config: `config/tsup.base.config.ts`
- Compiles `src/*` to `build/` as ESM modules
- Generates source maps and type declarations
- Uses `tsc-alias` to resolve path aliases after build
- Minifies in production, skips in dev/watch mode

**Testing (Vitest)**:

- Shared config: `config/vitest.base.config.ts`
- Tests in `tests/` directory with `*.test.ts` pattern
- Uses `vite-tsconfig-paths` for path resolution
- Globals enabled, Node environment

### Package Exports Pattern

Most packages use **wildcard exports** for granular imports:

```json
{
  "exports": {
    "./*": {
      "import": "./build/*.js",
      "types": "./build/*.d.ts"
    }
  }
}
```

This allows: `import { ... } from '@gpahal/std/arrays'`

Exceptions (single entry point):

- `@gpahal/logger` - exports `./build/index.js` only
- `@gpahal/og-image` - exports both `./build/index.js` and `./build/wasm.js`

### Dependency Management

- **Workspace Dependencies**: Use `workspace:*` for internal package dependencies
- **Peer Dependencies**: Config packages use optional peer dependencies for framework-specific plugins
- **Build Dependencies**: `pnpm-workspace.yaml` lists `onlyBuiltDependencies` (esbuild, sharp, etc.)

## Publishing

```bash
# Create changeset (version bump + changelog)
pnpm cs

# Publish all changed packages
pnpm cs-publish
```

Changesets workflow:

1. Run `pnpm cs` to create a changeset
2. Run `changeset version` to bump versions
3. Run `pnpm cs-publish` to publish (includes lint, format check, tests, and cleanup of git tags)

## Adding a New Package

See `packages/ADDING_A_PACKAGE.md` for checklist:

1. Create directory in `packages/`
2. Add `package.json` with unique name under `@gpahal/` scope
3. Copy `tsconfig.json`, `tsconfig.build.json`, and `tsup.config.ts` from similar package
4. Add `README.md` with package description
5. Add entry in root `tsconfig.json` references
6. Follow the standard `src/` structure

## Key Technologies

- **TypeScript 5.x** - All packages are TypeScript
- **tsup** - Fast build tool using esbuild
- **Vitest** - Test runner
- **Turborepo** - Monorepo build system with caching
- **pnpm** - Fast, disk-efficient package manager
- **Changesets** - Version management and publishing

## Important Notes

- All packages use **ESM** format (no CommonJS)
- All packages are marked `sideEffects: false` for tree-shaking
- Node.js version: >=20.0.0
- Builds depend on each other (turbo `dependsOn: ["^build"]`)
- Tests run after build (`dependsOn: ["build"]`)
