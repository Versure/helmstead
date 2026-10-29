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
