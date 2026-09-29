/**
 * Tests for link-queries tool
 * 
 * TDD Phase 4: Extract links and find backlinks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the silverbullet-api module
vi.mock('../silverbullet-api.js', () => ({
  listNotesAPI: vi.fn(),
  readNoteAPI: vi.fn(),
  writeNoteAPI: vi.fn(),
  deleteNoteAPI: vi.fn(),
}));

import * as api from '../silverbullet-api.js';
import { extractLinks, findBacklinks, type Link } from '../link-utils.js';

describe('link utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractLinks', () => {
    it('should extract simple wiki links', () => {
      const content = `# My Note

Check out [[Other Page]] for more info.

Also see [[Another Note]].`;

      const links = extractLinks(content);

      expect(links).toHaveLength(2);
      expect(links[0]).toEqual({
        target: 'Other Page',
        displayText: undefined,
        anchor: undefined,
        line: 3,
      });
      expect(links[1]).toEqual({
        target: 'Another Note',
        displayText: undefined,
        anchor: undefined,
        line: 5,
      });
    });

    it('should extract aliased wiki links', () => {
      const content = `See [[Long Page Name|click here]] for details.`;

      const links = extractLinks(content);

      expect(links).toHaveLength(1);
      expect(links[0]).toEqual({
        target: 'Long Page Name',
        displayText: 'click here',
        anchor: undefined,
        line: 1,
      });
    });

    it('should extract links with anchors', () => {
      const content = `See [[Page#section]] for the section.`;

      const links = extractLinks(content);

      expect(links).toHaveLength(1);
      expect(links[0]).toEqual({
        target: 'Page',
        displayText: undefined,
        anchor: 'section',
        line: 1,
      });
    });

    it('should extract links with both anchor and alias', () => {
      const content = `Check [[Page#section|this section]] out.`;

      const links = extractLinks(content);

      expect(links).toHaveLength(1);
      expect(links[0]).toEqual({
        target: 'Page',
        displayText: 'this section',
        anchor: 'section',
        line: 1,
      });
    });

    it('should handle multiple links on same line', () => {
      const content = `Compare [[Page A]] with [[Page B]] and [[Page C]].`;

      const links = extractLinks(content);

      expect(links).toHaveLength(3);
      expect(links.map(l => l.target)).toEqual(['Page A', 'Page B', 'Page C']);
      expect(links.every(l => l.line === 1)).toBe(true);
    });

    it('should return empty array for notes without links', () => {
      const content = `# Plain Note

Just regular text without any wiki links.`;

      const links = extractLinks(content);

      expect(links).toEqual([]);
    });

    it('should handle nested paths in links', () => {
      const content = `See [[folder/subfolder/Page]] for nested content.`;

      const links = extractLinks(content);

      expect(links).toHaveLength(1);
      expect(links[0].target).toBe('folder/subfolder/Page');
    });

    it('should not extract links inside code blocks', () => {
      const content = `# Code Example

\`\`\`
This [[Not A Link]] is in a code block
\`\`\`

But [[Real Link]] should be extracted.`;

      const links = extractLinks(content);

      expect(links).toHaveLength(1);
      expect(links[0].target).toBe('Real Link');
    });

    it('should not extract links inside inline code', () => {
      const content = `The syntax is \`[[Not A Link]]\` for wiki links.

But [[Real Link]] works.`;

      const links = extractLinks(content);

      expect(links).toHaveLength(1);
      expect(links[0].target).toBe('Real Link');
    });

    it('should handle special characters in page names', () => {
      const content = `See [[Page (with parens)]] and [[Page's Note]] here.`;

      const links = extractLinks(content);

      expect(links).toHaveLength(2);
      expect(links[0].target).toBe('Page (with parens)');
      expect(links[1].target).toBe("Page's Note");
    });

    it('should handle unicode in page names', () => {
      const content = `See [[日本語ページ]] for Japanese content.`;

      const links = extractLinks(content);

      expect(links).toHaveLength(1);
      expect(links[0].target).toBe('日本語ページ');
    });
  });

  describe('findBacklinks', () => {
    it('should find all notes linking to a given page', async () => {
      const mockList = vi.mocked(api.listNotesAPI);
      const mockRead = vi.mocked(api.readNoteAPI);

      mockList.mockResolvedValue([
        { name: 'Note A.md', perm: 'rw' },
        { name: 'Note B.md', perm: 'rw' },
        { name: 'Target.md', perm: 'rw' },
      ]);

      mockRead.mockImplementation(async (filename) => {
        if (filename === 'Note A.md') return 'Links to [[Target]] here.';
        if (filename === 'Note B.md') return 'Also [[Target]] and [[Other]].';
        if (filename === 'Target.md') return 'The target page content.';
        return '';
      });

      const backlinks = await findBacklinks('Target.md');

      expect(backlinks).toHaveLength(2);
      expect(backlinks.map(b => b.source)).toContain('Note A.md');
      expect(backlinks.map(b => b.source)).toContain('Note B.md');
    });

    it('should return empty array when no backlinks exist', async () => {
      const mockList = vi.mocked(api.listNotesAPI);
      const mockRead = vi.mocked(api.readNoteAPI);

      mockList.mockResolvedValue([
        { name: 'Note A.md', perm: 'rw' },
        { name: 'Isolated.md', perm: 'rw' },
      ]);

      mockRead.mockImplementation(async (filename) => {
        if (filename === 'Note A.md') return 'Links to [[Other Page]] only.';
        if (filename === 'Isolated.md') return 'No links at all.';
        return '';
      });

      const backlinks = await findBacklinks('Isolated.md');

      expect(backlinks).toEqual([]);
    });

    it('should not include self-references', async () => {
      const mockList = vi.mocked(api.listNotesAPI);
      const mockRead = vi.mocked(api.readNoteAPI);

      mockList.mockResolvedValue([
        { name: 'Note.md', perm: 'rw' },
      ]);

      mockRead.mockImplementation(async (filename) => {
        if (filename === 'Note.md') return 'Self link: [[Note]]';
        return '';
      });

      const backlinks = await findBacklinks('Note.md');

      expect(backlinks).toEqual([]);
    });

    it('should match links without .md extension', async () => {
      const mockList = vi.mocked(api.listNotesAPI);
      const mockRead = vi.mocked(api.readNoteAPI);

      mockList.mockResolvedValue([
        { name: 'Source.md', perm: 'rw' },
        { name: 'Target Page.md', perm: 'rw' },
      ]);

      mockRead.mockImplementation(async (filename) => {
        if (filename === 'Source.md') return 'Link to [[Target Page]] here.';
        if (filename === 'Target Page.md') return 'Target content.';
        return '';
      });

      const backlinks = await findBacklinks('Target Page.md');

      expect(backlinks).toHaveLength(1);
      expect(backlinks[0].source).toBe('Source.md');
    });

    it('should include link details in results', async () => {
      const mockList = vi.mocked(api.listNotesAPI);
      const mockRead = vi.mocked(api.readNoteAPI);

      mockList.mockResolvedValue([
        { name: 'Source.md', perm: 'rw' },
        { name: 'Target.md', perm: 'rw' },
      ]);

      mockRead.mockImplementation(async (filename) => {
        if (filename === 'Source.md') return 'See [[Target#section|details]] here.';
        if (filename === 'Target.md') return 'Target content.';
        return '';
      });

      const backlinks = await findBacklinks('Target.md');

      expect(backlinks).toHaveLength(1);
      expect(backlinks[0].links[0]).toEqual({
        target: 'Target',
        displayText: 'details',
        anchor: 'section',
        line: 1,
      });
    });

    it('should handle nested folder paths', async () => {
      const mockList = vi.mocked(api.listNotesAPI);
      const mockRead = vi.mocked(api.readNoteAPI);

      mockList.mockResolvedValue([
        { name: 'Source.md', perm: 'rw' },
        { name: 'folder/Target.md', perm: 'rw' },
      ]);

      mockRead.mockImplementation(async (filename) => {
        if (filename === 'Source.md') return 'Link to [[folder/Target]] here.';
        if (filename === 'folder/Target.md') return 'Target in folder.';
        return '';
      });

      const backlinks = await findBacklinks('folder/Target.md');

      expect(backlinks).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('should handle empty content', () => {
      const links = extractLinks('');
      expect(links).toEqual([]);
    });

    it('should handle malformed links gracefully', () => {
      const content = `Broken [[link and [[Another]] here.`;

      // Should extract what it can
      const links = extractLinks(content);
      
      expect(links.some(l => l.target === 'Another')).toBe(true);
    });

    it('should handle very long page names', () => {
      const longName = 'A'.repeat(200);
      const content = `Link to [[${longName}]] here.`;

      const links = extractLinks(content);

      expect(links).toHaveLength(1);
      expect(links[0].target).toBe(longName);
    });
  });
});
