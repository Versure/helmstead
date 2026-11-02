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

const isFrontendLibRoot = (root: string) =>
  root === 'libs/ui' || /^libs\/web\/[^/]+\/[^/]+$/.test(root);

/**
 * Every frontend project (`scope:web`) other than `apps/web` is a lib in `libs/web/<domain>/<type>` or `libs/ui`, and
 * carries exactly one `domain:` and one `type:` tag that match its folder; its domain has a boundary rule. `apps/web`
 * carries `type:app` and no domain (ADR-004). A scope:web project anywhere else would escape the layer rules.
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
    if (!tags.includes('scope:web')) {
      // Frontend tags outside scope:web would let a project be imported by every layer without the web lint rules.
      const frontendTags = [
        ...domains,
        ...types.filter((tag) => FRONTEND_TYPES.includes(tag)),
      ];
      if (types.some((tag) => FRONTEND_TYPES.includes(tag))) {
        errors.push(
          `Project "${name}" carries frontend tags (${frontendTags.join(', ')}) but not scope:web; frontend projects are scope:web.`,
        );
      }
      continue;
    }
    if (!isFrontendLibRoot(root)) {
      errors.push(
        `Frontend project "${name}" is in ${root}; frontend libs live in libs/web/<domain>/<type> or libs/ui.`,
      );
      continue;
    }

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

    // libs/web/<domain>/<type> must say what its tags say, so the folder tells the truth about the rules.
    const [, , folderDomain, folderType] = root.split('/');
    const domainTag = domains.length === 1 ? domains[0] : undefined;
    const typeTag = types.length === 1 ? types[0] : undefined;
    if (
      root !== 'libs/ui' &&
      domainTag &&
      typeTag &&
      FRONTEND_TYPES.includes(typeTag) &&
      (domainTag === 'domain:shared' ||
        FRONTEND_DOMAINS.includes(domainTag.slice('domain:'.length))) &&
      (domainTag !== `domain:${folderDomain}` ||
        typeTag !== `type:${folderType}`)
    ) {
      errors.push(
        `Frontend project "${name}" is tagged ${domainTag}, ${typeTag} but lives in ${root}; move it to libs/web/${domainTag.slice('domain:'.length)}/${typeTag.slice('type:'.length)}.`,
      );
    }
  }

  return errors;
}
