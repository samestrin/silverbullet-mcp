/**
 * Utilities for appending content to notes.
 */

import { readNoteAPI, writeNoteAPI } from './silverbullet-api.js';

export interface AppendResult {
  success: boolean;
  created: boolean;
  message: string;
}

export interface AppendOptions {
  /** Separator between existing and new content. Default: '\n\n' */
  separator?: string;
  /** Create note if it doesn't exist. Default: true */
  createIfMissing?: boolean;
}

/**
 * Appends content to a note, creating it if necessary.
 *
 * @param filename - The note filename (must end with .md)
 * @param content - The content to append
 * @param options - Optional settings
 * @returns Result indicating success/failure and whether note was created
 */
export async function appendToNote(
  filename: string,
  content: string,
  options: AppendOptions = {}
): Promise<AppendResult> {
  const { separator = '\n\n', createIfMissing = true } = options;

  // Validate filename
  if (!filename.endsWith('.md')) {
    return {
      success: false,
      created: false,
      message: 'Filename must end with .md extension',
    };
  }

  // Validate content
  if (!content || !content.trim()) {
    return {
      success: false,
      created: false,
      message: 'Content cannot be empty or whitespace-only',
    };
  }

  let existingContent: string | null = null;
  let noteExists = true;

  // Try to read existing note
  try {
    existingContent = await readNoteAPI(filename);
  } catch (error) {
    noteExists = false;
    
    if (!createIfMissing) {
      return {
        success: false,
        created: false,
        message: `Note not found: ${filename}. Set createIfMissing: true to create it.`,
      };
    }
  }

  // Determine final content
  let finalContent: string;

  if (!noteExists || existingContent === null) {
    // Creating new note - just use the content
    finalContent = content;
  } else if (!existingContent.trim()) {
    // Existing note is empty or whitespace-only - replace with new content
    finalContent = content;
  } else {
    // Append to existing content
    finalContent = existingContent + separator + content;
  }

  // Write the note
  try {
    await writeNoteAPI(filename, finalContent);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      created: false,
      message: `Failed to write note: ${errorMessage}`,
    };
  }

  return {
    success: true,
    created: !noteExists,
    message: noteExists
      ? `Appended content to ${filename}`
      : `Created ${filename} with content`,
  };
}
