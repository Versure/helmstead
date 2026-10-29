import { FRONTEND_DOMAINS, FRONTEND_TYPES } from './frontend-tags.mjs';

export const KNOWN_SCOPES = ['scope:web', 'scope:core', 'scope:shared'];

export interface ProjectTags {
  name: string;
  tags: string[];
}

/** Every Nx project carries exactly one `scope:` tag, and it is one of the known scopes (ADR-002). */
export function checkScopeTags(projects: ProjectTags[]): string[] {
  const errors: string[] = [];

  for (const { name, tags } of projects) {
    const scopes = tags.filter((tag) => tag.startsWith('scope:'));

    if (scopes.length === 0) {
      errors.push(`Project "${name}" has no scope: tag; it needs exactly one.`);
    } else if (scopes.length > 1) {
      errors.push(
        `Project "${name}" has ${scopes.length} scope: tags (${scopes.join(', ')}); it needs exactly one.`,
      );
    } else if (!KNOWN_SCOPES.includes(scopes[0])) {
      errors.push(
        `Project "${name}" uses unknown tag "${scopes[0]}"; known scopes are ${KNOWN_SCOPES.join(', ')}.`,
      );
    }
  }

  return errors;
}

export interface FrontendProject extends ProjectTags {
  root: string;
}

const isFrontendLib = (root: string) =>
  root === 'libs/ui' || root.startsWith('libs/web/');

/**
 * Every frontend lib (`libs/web/**`, `libs/ui`) carries exactly one `domain:` and one `type:` tag, and its domain has a
 * boundary rule; `apps/web` carries `type:app` and no domain (ADR-004).
 */
export function checkFrontendTags(projects: FrontendProject[]): string[] {
  const errors: string[] = [];

  for (const { name, root, tags } of projects) {
    const domains = tags.filter((tag) => tag.startsWith('domain:'));
    const types = tags.filter((tag) => tag.startsWith('type:'));

    if (root === 'apps/web') {
      if (domains.length > 0 || types.length !== 1 || types[0] !== 'type:app') {
        errors.push(
          `Frontend app "${name}" must carry type:app and no domain: tag.`,
        );
      }
      continue;
    }
    if (!isFrontendLib(root)) continue;

    if (domains.length === 0) {
      errors.push(
        `Frontend project "${name}" has no domain: tag; it needs exactly one (domain:<name> or domain:shared).`,
      );
    } else if (domains.length > 1) {
      errors.push(
        `Frontend project "${name}" has ${domains.length} domain: tags (${domains.join(', ')}); it needs exactly one.`,
      );
    } else {
      const domain = domains[0].slice('domain:'.length);
      if (domain !== 'shared' && !FRONTEND_DOMAINS.includes(domain)) {
        errors.push(
          `Frontend project "${name}" uses domain "${domains[0]}", which has no boundary rule; add "${domain}" to tools/workspace/frontend-tags.mjs.`,
        );
      }
    }

    if (types.length === 0) {
      errors.push(
        `Frontend project "${name}" has no type: tag; it needs exactly one of ${FRONTEND_TYPES.join(', ')}.`,
      );
    } else if (types.length > 1) {
      errors.push(
        `Frontend project "${name}" has ${types.length} type: tags (${types.join(', ')}); it needs exactly one.`,
      );
    } else if (!FRONTEND_TYPES.includes(types[0])) {
      errors.push(
        `Frontend project "${name}" uses unknown tag "${types[0]}"; known types are ${FRONTEND_TYPES.join(', ')}.`,
      );
    }
  }

  return errors;
}
