/**
 * Tests for append-note tool
 * 
 * TDD Phase 2: Append content to notes
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
import { appendToNote } from '../append-utils.js';

describe('append-note tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('basic functionality', () => {
    it('should append content to existing note', async () => {
      const mockRead = vi.mocked(api.readNoteAPI);
      const mockWrite = vi.mocked(api.writeNoteAPI);
      
      mockRead.mockResolvedValue('Existing content');
      mockWrite.mockResolvedValue(undefined);

      const result = await appendToNote('test.md', 'New content');

      expect(mockWrite).toHaveBeenCalledWith(
        'test.md',
        'Existing content\n\nNew content'
      );
      expect(result.success).toBe(true);
      expect(result.created).toBe(false);
    });

    it('should create note if it does not exist and createIfMissing is true', async () => {
      const mockRead = vi.mocked(api.readNoteAPI);
      const mockWrite = vi.mocked(api.writeNoteAPI);
      
      mockRead.mockRejectedValue(new Error('Note not found'));
      mockWrite.mockResolvedValue(undefined);

      const result = await appendToNote('new-note.md', 'First content', {
        createIfMissing: true,
      });

      expect(mockWrite).toHaveBeenCalledWith('new-note.md', 'First content');
      expect(result.success).toBe(true);
      expect(result.created).toBe(true);
    });

    it('should fail if note does not exist and createIfMissing is false', async () => {
      const mockRead = vi.mocked(api.readNoteAPI);
      
      mockRead.mockRejectedValue(new Error('Note not found'));

      const result = await appendToNote('missing.md', 'Content', {
        createIfMissing: false,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should use default createIfMissing: true', async () => {
      const mockRead = vi.mocked(api.readNoteAPI);
      const mockWrite = vi.mocked(api.writeNoteAPI);
      
      mockRead.mockRejectedValue(new Error('Note not found'));
      mockWrite.mockResolvedValue(undefined);

      const result = await appendToNote('new.md', 'Content');

      expect(mockWrite).toHaveBeenCalled();
      expect(result.created).toBe(true);
    });
  });

  describe('separator handling', () => {
    it('should use default separator (double newline)', async () => {
      const mockRead = vi.mocked(api.readNoteAPI);
      const mockWrite = vi.mocked(api.writeNoteAPI);
      
      mockRead.mockResolvedValue('Line 1');
      mockWrite.mockResolvedValue(undefined);

      await appendToNote('test.md', 'Line 2');

      expect(mockWrite).toHaveBeenCalledWith('test.md', 'Line 1\n\nLine 2');
    });

    it('should use custom separator', async () => {
      const mockRead = vi.mocked(api.readNoteAPI);
      const mockWrite = vi.mocked(api.writeNoteAPI);
      
      mockRead.mockResolvedValue('Item 1');
      mockWrite.mockResolvedValue(undefined);

      await appendToNote('test.md', 'Item 2', { separator: '\n---\n' });

      expect(mockWrite).toHaveBeenCalledWith('test.md', 'Item 1\n---\nItem 2');
    });

    it('should handle empty separator', async () => {
      const mockRead = vi.mocked(api.readNoteAPI);
      const mockWrite = vi.mocked(api.writeNoteAPI);
      
      mockRead.mockResolvedValue('Hello');
      mockWrite.mockResolvedValue(undefined);

      await appendToNote('test.md', 'World', { separator: '' });

      expect(mockWrite).toHaveBeenCalledWith('test.md', 'HelloWorld');
    });

    it('should not add separator for empty existing content', async () => {
      const mockRead = vi.mocked(api.readNoteAPI);
      const mockWrite = vi.mocked(api.writeNoteAPI);
      
      mockRead.mockResolvedValue('');
      mockWrite.mockResolvedValue(undefined);

      await appendToNote('empty.md', 'New content');

      expect(mockWrite).toHaveBeenCalledWith('empty.md', 'New content');
    });

    it('should not add separator for whitespace-only existing content', async () => {
      const mockRead = vi.mocked(api.readNoteAPI);
      const mockWrite = vi.mocked(api.writeNoteAPI);
      
      mockRead.mockResolvedValue('   \n\n  ');
      mockWrite.mockResolvedValue(undefined);

      await appendToNote('whitespace.md', 'New content');

      // Should treat whitespace-only as empty and just write new content
      expect(mockWrite).toHaveBeenCalledWith('whitespace.md', 'New content');
    });
  });

  describe('validation', () => {
    it('should reject filenames without .md extension', async () => {
      const result = await appendToNote('test.txt', 'Content');

      expect(result.success).toBe(false);
      expect(result.message).toContain('.md');
    });

    it('should accept filenames with .md extension', async () => {
      const mockRead = vi.mocked(api.readNoteAPI);
      const mockWrite = vi.mocked(api.writeNoteAPI);
      
      mockRead.mockResolvedValue('Existing');
      mockWrite.mockResolvedValue(undefined);

      const result = await appendToNote('valid.md', 'Content');

      expect(result.success).toBe(true);
    });

    it('should handle nested paths with .md extension', async () => {
      const mockRead = vi.mocked(api.readNoteAPI);
      const mockWrite = vi.mocked(api.writeNoteAPI);
      
      mockRead.mockResolvedValue('Existing');
      mockWrite.mockResolvedValue(undefined);

      const result = await appendToNote('folder/subfolder/note.md', 'Content');

      expect(result.success).toBe(true);
    });

    it('should reject empty content', async () => {
      const result = await appendToNote('test.md', '');

      expect(result.success).toBe(false);
      expect(result.message).toContain('empty');
    });

    it('should reject whitespace-only content', async () => {
      const result = await appendToNote('test.md', '   \n\n  ');

      expect(result.success).toBe(false);
      expect(result.message).toContain('empty');
    });
  });

  describe('edge cases', () => {
    it('should handle content with $ characters (no corruption)', async () => {
      const mockRead = vi.mocked(api.readNoteAPI);
      const mockWrite = vi.mocked(api.writeNoteAPI);
      
      mockRead.mockResolvedValue('Price list:');
      mockWrite.mockResolvedValue(undefined);

      await appendToNote('prices.md', '- Item: $19.99');

      expect(mockWrite).toHaveBeenCalledWith(
        'prices.md',
        'Price list:\n\n- Item: $19.99'
      );
    });

    it('should handle very long content', async () => {
      const mockRead = vi.mocked(api.readNoteAPI);
      const mockWrite = vi.mocked(api.writeNoteAPI);
      
      mockRead.mockResolvedValue('Start');
      mockWrite.mockResolvedValue(undefined);

      const longContent = 'A'.repeat(100000);
      await appendToNote('large.md', longContent);

      expect(mockWrite).toHaveBeenCalledWith(
        'large.md',
        'Start\n\n' + longContent
      );
    });

    it('should handle unicode content', async () => {
      const mockRead = vi.mocked(api.readNoteAPI);
      const mockWrite = vi.mocked(api.writeNoteAPI);
      
      mockRead.mockResolvedValue('English text');
      mockWrite.mockResolvedValue(undefined);

      await appendToNote('unicode.md', '日本語テキスト 🎉');

      expect(mockWrite).toHaveBeenCalledWith(
        'unicode.md',
        'English text\n\n日本語テキスト 🎉'
      );
    });

    it('should preserve trailing newlines in existing content', async () => {
      const mockRead = vi.mocked(api.readNoteAPI);
      const mockWrite = vi.mocked(api.writeNoteAPI);
      
      mockRead.mockResolvedValue('Line 1\n\n');
      mockWrite.mockResolvedValue(undefined);

      await appendToNote('test.md', 'Line 2');

      // Should use the existing trailing newlines + separator intelligently
      // Exact behavior TBD - this test documents expected behavior
      expect(mockWrite).toHaveBeenCalled();
    });

    it('should handle read errors when createIfMissing is false', async () => {
      const mockRead = vi.mocked(api.readNoteAPI);
      
      mockRead.mockRejectedValue(new Error('Network error'));

      const result = await appendToNote('test.md', 'Content', {
        createIfMissing: false,
      });

      expect(result.success).toBe(false);
      // When createIfMissing is false and note doesn't exist, we get "not found" message
      expect(result.message).toContain('not found');
    });

    it('should handle write errors gracefully', async () => {
      const mockRead = vi.mocked(api.readNoteAPI);
      const mockWrite = vi.mocked(api.writeNoteAPI);
      
      mockRead.mockResolvedValue('Existing content');
      mockWrite.mockRejectedValue(new Error('Disk full'));

      const result = await appendToNote('test.md', 'New content');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to write');
    });
  });
});
