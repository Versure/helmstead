# Lint fixture projects

Nx projects that exist only so `tools/eslint/boundaries.spec.ts` has a project of every `domain:`/`type:` pair to import.
They have no real build (`nx:noop`), the tag checks skip them, and no real code may import them
(`no-restricted-imports` in the root `eslint.config.mjs`).
