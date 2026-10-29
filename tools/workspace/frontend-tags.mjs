// The frontend's domain and layer tags (docs/adr/004-frontend-architecture.md). The root eslint.config.mjs builds
// one `domain:` dependency constraint per entry, and the tag check fails a project whose domain is not listed here,
// so a new domain is always added on purpose, in this file, and gets its boundary rule with it.
export const FRONTEND_DOMAINS = ['system'];

export const FRONTEND_TYPES = [
  'type:feature',
  'type:ui',
  'type:data-access',
  'type:model',
  'type:util',
  'type:api',
];
