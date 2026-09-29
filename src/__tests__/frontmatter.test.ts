/**
 * Tests for frontmatter-get and frontmatter-set tools
 * 
 * TDD Phase 3: YAML frontmatter manipulation
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
import {
  parseFrontmatter,
  serializeFrontmatter,
  getFrontmatterValue,
  setFrontmatterValue,
} from '../frontmatter-utils.js';

describe('frontmatter utilities', () => {
  describe('parseFrontmatter', () => {
    it('should parse YAML frontmatter from note', () => {
      const content = `---
title: My Note
tags:
  - important
  - todo
date: 2024-01-15
---

# Content here

Some body text.`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({
        title: 'My Note',
        tags: ['important', 'todo'],
        date: '2024-01-15',
      });
      expect(result.body).toBe('\n# Content here\n\nSome body text.');
    });

    it('should return empty object for notes without frontmatter', () => {
      const content = `# Just a heading

Some content without frontmatter.`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe(content);
    });

    it('should handle empty frontmatter block', () => {
      const content = `---
---

Body content`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe('\nBody content');
    });

    it('should handle frontmatter with complex nested values', () => {
      const content = `---
metadata:
  author: John Doe
  published: true
  stats:
    views: 100
    likes: 50
---

Body`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({
        metadata: {
          author: 'John Doe',
          published: true,
          stats: {
            views: 100,
            likes: 50,
          },
        },
      });
    });

    it('should handle frontmatter-only content (no body)', () => {
      const content = `---
title: Metadata Only
---`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({ title: 'Metadata Only' });
      expect(result.body).toBe('');
    });

    it('should not confuse --- in body with frontmatter', () => {
      const content = `---
title: Test
---

Some content

---

More content after horizontal rule`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({ title: 'Test' });
      expect(result.body).toContain('---');
      expect(result.body).toContain('More content after horizontal rule');
    });
  });

  describe('serializeFrontmatter', () => {
    it('should serialize frontmatter and body into note content', () => {
      const frontmatter = { title: 'Test', tags: ['a', 'b'] };
      const body = '\n# Content\n\nBody text.';

      const result = serializeFrontmatter(frontmatter, body);

      expect(result).toContain('---');
      expect(result).toContain('title: Test');
      expect(result).toContain('tags:');
      expect(result).toContain('# Content');
    });

    it('should handle empty frontmatter', () => {
      const result = serializeFrontmatter({}, 'Just body');

      // With empty frontmatter, might include empty block or just body
      expect(result).toContain('Just body');
    });

    it('should handle empty body', () => {
      const result = serializeFrontmatter({ title: 'Test' }, '');

      expect(result).toContain('title: Test');
    });

    it('should preserve special characters in values', () => {
      const frontmatter = { 
        description: 'Price: $100',
        quote: "It's a \"test\"",
      };

      const result = serializeFrontmatter(frontmatter, '');
      const parsed = parseFrontmatter(result);

      expect(parsed.frontmatter.description).toBe('Price: $100');
      expect(parsed.frontmatter.quote).toBe("It's a \"test\"");
    });
  });

  describe('getFrontmatterValue', () => {
    const noteWithFrontmatter = `---
title: My Note
author: John
nested:
  level1:
    level2: deep value
tags:
  - a
  - b
---

Body content`;

    it('should return entire frontmatter when no key provided', () => {
      const result = getFrontmatterValue(noteWithFrontmatter);

      expect(result).toEqual({
        title: 'My Note',
        author: 'John',
        nested: {
          level1: {
            level2: 'deep value',
          },
        },
        tags: ['a', 'b'],
      });
    });

    it('should return specific field value', () => {
      const result = getFrontmatterValue(noteWithFrontmatter, 'title');

      expect(result).toBe('My Note');
    });

    it('should return nested value with dot notation', () => {
      const result = getFrontmatterValue(noteWithFrontmatter, 'nested.level1.level2');

      expect(result).toBe('deep value');
    });

    it('should return undefined for non-existent key', () => {
      const result = getFrontmatterValue(noteWithFrontmatter, 'nonexistent');

      expect(result).toBeUndefined();
    });

    it('should return undefined for non-existent nested key', () => {
      const result = getFrontmatterValue(noteWithFrontmatter, 'nested.nonexistent.path');

      expect(result).toBeUndefined();
    });

    it('should return array values', () => {
      const result = getFrontmatterValue(noteWithFrontmatter, 'tags');

      expect(result).toEqual(['a', 'b']);
    });

    it('should return empty object for note without frontmatter', () => {
      const result = getFrontmatterValue('Just body content');

      expect(result).toEqual({});
    });
  });

  describe('setFrontmatterValue', () => {
    const noteWithFrontmatter = `---
title: Original
count: 5
---

Body content`;

    it('should update existing field', () => {
      const result = setFrontmatterValue(noteWithFrontmatter, 'title', 'Updated');
      const parsed = parseFrontmatter(result);

      expect(parsed.frontmatter.title).toBe('Updated');
      expect(parsed.frontmatter.count).toBe(5); // Other fields preserved
      expect(parsed.body).toContain('Body content');
    });

    it('should add new field', () => {
      const result = setFrontmatterValue(noteWithFrontmatter, 'newField', 'new value');
      const parsed = parseFrontmatter(result);

      expect(parsed.frontmatter.newField).toBe('new value');
      expect(parsed.frontmatter.title).toBe('Original');
    });

    it('should handle nested field with dot notation', () => {
      const result = setFrontmatterValue(noteWithFrontmatter, 'meta.author', 'John');
      const parsed = parseFrontmatter(result);

      expect(parsed.frontmatter.meta).toEqual({ author: 'John' });
    });

    it('should update deeply nested field', () => {
      const content = `---
a:
  b:
    c: old
---
Body`;

      const result = setFrontmatterValue(content, 'a.b.c', 'new');
      const parsed = parseFrontmatter(result);

      expect(parsed.frontmatter.a).toEqual({ b: { c: 'new' } });
    });

    it('should create frontmatter if none exists', () => {
      const content = 'Just body content';

      const result = setFrontmatterValue(content, 'title', 'New Title');
      const parsed = parseFrontmatter(result);

      expect(parsed.frontmatter.title).toBe('New Title');
      expect(parsed.body).toContain('Just body content');
    });

    it('should handle array values', () => {
      const result = setFrontmatterValue(noteWithFrontmatter, 'tags', ['x', 'y', 'z']);
      const parsed = parseFrontmatter(result);

      expect(parsed.frontmatter.tags).toEqual(['x', 'y', 'z']);
    });

    it('should handle boolean values', () => {
      const result = setFrontmatterValue(noteWithFrontmatter, 'published', true);
      const parsed = parseFrontmatter(result);

      expect(parsed.frontmatter.published).toBe(true);
    });

    it('should handle numeric values', () => {
      const result = setFrontmatterValue(noteWithFrontmatter, 'count', 42);
      const parsed = parseFrontmatter(result);

      expect(parsed.frontmatter.count).toBe(42);
    });

    it('should handle null values (delete field)', () => {
      const result = setFrontmatterValue(noteWithFrontmatter, 'count', null);
      const parsed = parseFrontmatter(result);

      expect(parsed.frontmatter.count).toBeNull();
    });

    it('should preserve body content exactly', () => {
      const content = `---
title: Test
---

# Heading

- List item
- Another item

\`\`\`code
const x = 1;
\`\`\``;

      const result = setFrontmatterValue(content, 'title', 'Updated');
      const parsed = parseFrontmatter(result);

      expect(parsed.body).toContain('# Heading');
      expect(parsed.body).toContain('- List item');
      expect(parsed.body).toContain('const x = 1;');
    });
  });

  describe('edge cases', () => {
    it('should handle malformed YAML gracefully', () => {
      const badYaml = `---
title: [unclosed bracket
invalid: : : colon
---

Body`;

      // Should either throw a specific error or return empty frontmatter
      expect(() => parseFrontmatter(badYaml)).toThrow();
    });

    it('should handle frontmatter with only whitespace', () => {
      const content = `---
   
---

Body`;

      const result = parseFrontmatter(content);
      expect(result.frontmatter).toEqual({});
    });

    it('should handle unicode in frontmatter', () => {
      const content = `---
title: 日本語タイトル
emoji: 🎉
---

Body`;

      const result = parseFrontmatter(content);
      expect(result.frontmatter.title).toBe('日本語タイトル');
      expect(result.frontmatter.emoji).toBe('🎉');
    });

    it('should handle $ characters in frontmatter values', () => {
      const content = `---
price: $100
variable: $PATH
---

Body`;

      const result = parseFrontmatter(content);
      expect(result.frontmatter.price).toBe('$100');
      expect(result.frontmatter.variable).toBe('$PATH');
    });
  });
});
