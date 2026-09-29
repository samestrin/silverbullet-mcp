/**
 * Utilities for YAML frontmatter manipulation in notes.
 * 
 * Frontmatter is YAML content at the beginning of a note, delimited by ---
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface ParsedNote {
  frontmatter: Record<string, unknown>;
  body: string;
}

// Match frontmatter with body - capture group can be empty
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n?---\r?\n?([\s\S]*)$/;
// Match frontmatter only (no body after closing ---)
const FRONTMATTER_ONLY_REGEX = /^---\r?\n([\s\S]*?)\r?\n?---$/;

/**
 * Parses YAML frontmatter from note content.
 * 
 * @param content - The note content
 * @returns Object with frontmatter (parsed YAML) and body (remaining content)
 * @throws Error if frontmatter contains invalid YAML
 */
export function parseFrontmatter(content: string): ParsedNote {
  // Try to match frontmatter with body
  let match = content.match(FRONTMATTER_REGEX);
  
  if (!match) {
    // Try frontmatter-only (no body after ---)
    match = content.match(FRONTMATTER_ONLY_REGEX);
    if (match) {
      const yamlContent = match[1];
      const frontmatter = yamlContent.trim() ? parseYaml(yamlContent) : {};
      return {
        frontmatter: frontmatter ?? {},
        body: '',
      };
    }
    
    // No frontmatter found
    return {
      frontmatter: {},
      body: content,
    };
  }

  const yamlContent = match[1];
  const body = match[2];

  // Parse YAML (may throw on invalid YAML)
  const frontmatter = yamlContent.trim() ? parseYaml(yamlContent) : {};

  return {
    frontmatter: frontmatter ?? {},
    body,
  };
}

/**
 * Serializes frontmatter and body back into note content.
 * 
 * @param frontmatter - The frontmatter object
 * @param body - The body content
 * @returns Complete note content with frontmatter
 */
export function serializeFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string
): string {
  const hasContent = Object.keys(frontmatter).length > 0;
  
  if (!hasContent) {
    // Return just the body if no frontmatter
    return body;
  }

  const yamlStr = stringifyYaml(frontmatter).trim();
  
  return `---\n${yamlStr}\n---${body}`;
}

/**
 * Gets a value from frontmatter, optionally by key with dot notation.
 * 
 * @param content - The note content
 * @param key - Optional key (supports dot notation like 'meta.author')
 * @returns The value, or entire frontmatter if no key provided
 */
export function getFrontmatterValue(content: string, key?: string): unknown {
  const { frontmatter } = parseFrontmatter(content);

  if (!key) {
    return frontmatter;
  }

  // Handle dot notation for nested access
  const keys = key.split('.');
  let current: unknown = frontmatter;

  for (const k of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[k];
  }

  return current;
}

/**
 * Sets a value in frontmatter, creating nested structure if needed.
 * 
 * @param content - The note content
 * @param key - The key (supports dot notation)
 * @param value - The value to set
 * @returns Updated note content
 */
export function setFrontmatterValue(
  content: string,
  key: string,
  value: unknown
): string {
  const { frontmatter, body } = parseFrontmatter(content);

  // Handle dot notation for nested setting
  const keys = key.split('.');
  
  if (keys.length === 1) {
    // Simple key
    frontmatter[key] = value;
  } else {
    // Nested key
    let current: Record<string, unknown> = frontmatter;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in current) || typeof current[k] !== 'object' || current[k] === null) {
        current[k] = {};
      }
      current = current[k] as Record<string, unknown>;
    }
    
    current[keys[keys.length - 1]] = value;
  }

  return serializeFrontmatter(frontmatter, body);
}
