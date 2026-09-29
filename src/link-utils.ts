/**
 * Utilities for extracting and querying wiki links in notes.
 */

import { listNotesAPI, readNoteAPI } from './silverbullet-api.js';

export interface Link {
  /** The target page name */
  target: string;
  /** Optional display text (for aliased links) */
  displayText?: string;
  /** Optional anchor/section (for links with #) */
  anchor?: string;
  /** Line number where the link appears (1-indexed) */
  line: number;
}

export interface Backlink {
  /** Source note filename */
  source: string;
  /** Links from that note to the target */
  links: Link[];
}

// Regex to match wiki links: [[target]] or [[target|display]] or [[target#anchor]] or [[target#anchor|display]]
// Exclude [ from target to avoid matching nested/malformed links
const WIKI_LINK_REGEX = /\[\[([^\]|#\[]+)(?:#([^\]|\[]+))?(?:\|([^\]\[]+))?\]\]/g;

// Regex to match code blocks
const CODE_BLOCK_REGEX = /```[\s\S]*?```/g;

// Regex to match inline code
const INLINE_CODE_REGEX = /`[^`]+`/g;

/**
 * Extracts all wiki links from note content.
 * 
 * Handles formats:
 * - [[Page]] - simple link
 * - [[Page|Display]] - aliased link
 * - [[Page#anchor]] - link with anchor
 * - [[Page#anchor|Display]] - link with anchor and alias
 * 
 * Excludes links inside code blocks and inline code.
 * 
 * @param content - The note content
 * @returns Array of Link objects with target, displayText, anchor, and line number
 */
export function extractLinks(content: string): Link[] {
  if (!content) return [];

  // Remove code blocks and inline code to avoid false matches
  const contentWithoutCode = content
    .replace(CODE_BLOCK_REGEX, (match) => ' '.repeat(match.length))
    .replace(INLINE_CODE_REGEX, (match) => ' '.repeat(match.length));

  const links: Link[] = [];
  const lines = content.split('\n');
  const linesWithoutCode = contentWithoutCode.split('\n');

  for (let i = 0; i < linesWithoutCode.length; i++) {
    const line = linesWithoutCode[i];
    let match;

    // Reset regex state
    WIKI_LINK_REGEX.lastIndex = 0;

    while ((match = WIKI_LINK_REGEX.exec(line)) !== null) {
      const target = match[1].trim();
      const anchor = match[2]?.trim();
      const displayText = match[3]?.trim();

      links.push({
        target,
        displayText: displayText || undefined,
        anchor: anchor || undefined,
        line: i + 1, // 1-indexed
      });
    }
  }

  return links;
}

/**
 * Finds all notes that link to a given page.
 * 
 * @param filename - The target filename (with .md extension)
 * @returns Array of Backlink objects containing source notes and their links
 */
export async function findBacklinks(filename: string): Promise<Backlink[]> {
  // Get the target name without .md extension for matching
  const targetName = filename.replace(/\.md$/, '');

  // List all notes
  const notes = await listNotesAPI();

  const backlinks: Backlink[] = [];

  // Check each note for links to the target
  for (const note of notes) {
    // Skip the target file itself
    if (note.name === filename) continue;

    try {
      const content = await readNoteAPI(note.name);
      const links = extractLinks(content);

      // Filter links that point to our target
      const relevantLinks = links.filter((link) => {
        // Match exact name or name with path
        const linkTarget = link.target.replace(/\.md$/, '');
        return (
          linkTarget === targetName ||
          linkTarget.endsWith('/' + targetName) ||
          targetName.endsWith('/' + linkTarget)
        );
      });

      if (relevantLinks.length > 0) {
        backlinks.push({
          source: note.name,
          links: relevantLinks,
        });
      }
    } catch (error) {
      // Skip notes that can't be read
      console.error(`Failed to read ${note.name} for backlink analysis:`, error);
    }
  }

  return backlinks;
}

/**
 * Gets outgoing links from a note.
 * 
 * @param filename - The source filename
 * @returns Array of Link objects
 */
export async function getOutgoingLinks(filename: string): Promise<Link[]> {
  const content = await readNoteAPI(filename);
  return extractLinks(content);
}
