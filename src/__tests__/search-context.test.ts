/**
 * Tests for search-notes context handling.
 *
 * Regression guard: `contextLines` was silently ignored whenever `concise` was
 * true -- and `concise` defaults to true. A caller who asked for 10 lines of
 * context got zero, with no warning, and reasonably concluded the tool could
 * not return context at all.
 *
 * `concise` controls output DENSITY. It must not decide whether a parameter
 * the caller explicitly set is honoured.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../silverbullet-api.js', () => ({
    listNotesAPI: vi.fn(),
    readNoteAPI: vi.fn(),
    writeNoteAPI: vi.fn(),
    deleteNoteAPI: vi.fn(),
}));

vi.mock('../cache.js', () => ({
    getCachedNoteContent: vi.fn(),
}));

import * as api from '../silverbullet-api.js';
import * as cache from '../cache.js';
import { configureMcpServerInstance } from '../mcp-server.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[] }>;

/** Capture a registered tool's handler without constructing a real McpServer. */
function captureTool(name: string): ToolHandler {
    const tools = new Map<string, ToolHandler>();
    const stub = {
        registerTool: (toolName: string, _schema: unknown, handler: ToolHandler) => {
            tools.set(toolName, handler);
        },
        registerResource: () => {},
    };
    configureMcpServerInstance(stub as unknown as McpServer);
    const handler = tools.get(name);
    if (!handler) throw new Error(`tool not registered: ${name}`);
    return handler;
}

// The SDK applies zod defaults; calling the raw callback does not. Pass every field.
const baseArgs = {
    query: 'Line 2',
    searchType: 'content' as const,
    caseSensitive: false,
    maxResults: 10,
    page: 1,
    contextLines: 1,
    concise: true,
    enableCaching: false,
};

describe('search-notes: contextLines is honoured in both modes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(api.listNotesAPI).mockResolvedValue([{ name: 'multi.md', perm: 'rw' }] as never);
        vi.mocked(cache.getCachedNoteContent).mockResolvedValue(
            'Line 1: Hello world\nLine 2: This is a test\nLine 3: More content here\nLine 4: Final line'
        );
    });

    it('returns surrounding lines in CONCISE mode when contextLines > 0', async () => {
        const res = await captureTool('search-notes')(baseArgs);
        const text = res.content[0].text;
        expect(text).toContain('Line 2: This is a test');
        expect(text).toContain('Line 1: Hello world');
        expect(text).toContain('Line 3: More content here');
    });

    it('returns NO context in concise mode when contextLines is 0', async () => {
        const res = await captureTool('search-notes')({ ...baseArgs, contextLines: 0 });
        const text = res.content[0].text;
        expect(text).toContain('Line 2: This is a test');
        expect(text).not.toContain('Line 1: Hello world');
        expect(text).not.toContain('Line 3: More content here');
    });

    it('still returns context in verbose mode', async () => {
        const res = await captureTool('search-notes')({ ...baseArgs, concise: false });
        const text = res.content[0].text;
        expect(text).toContain('Line 1: Hello world');
        expect(text).toContain('Line 3: More content here');
    });
});
