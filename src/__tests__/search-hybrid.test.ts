/**
 * Integration tests: search-notes uses the hybrid search strategy.
 *
 * The tool's input schema and output format are unchanged (AC5) — these
 * tests pin the new behavior: index path when the Runtime API has a search
 * library, silent fallback to scan otherwise, and zero-result validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../silverbullet-api.js', () => ({
    listNotesAPI: vi.fn(),
    readNoteAPI: vi.fn(),
    writeNoteAPI: vi.fn(),
    deleteNoteAPI: vi.fn(),
    getFullFileListingAPI: vi.fn(),
}));

vi.mock('../cache.js', () => ({
    getCachedNoteContent: vi.fn(),
}));

vi.mock('../runtime-client.js', () => ({
    createRuntimeClient: vi.fn(),
}));

import * as api from '../silverbullet-api.js';
import * as cache from '../cache.js';
import { createRuntimeClient } from '../runtime-client.js';
import { resetCapsCache } from '../caps-store.js';
import { configureMcpServerInstance } from '../mcp-server.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[] }>;

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

const baseArgs = {
    query: 'keyword',
    searchType: 'content' as const,
    caseSensitive: false,
    maxResults: 10,
    page: 1,
    contextLines: 1,
    concise: true,
    enableCaching: false,
};

const mockRuntime = {
    probeCapabilities: vi.fn(),
    fulltextSearch: vi.fn(),
};

beforeEach(() => {
    vi.clearAllMocks();
    resetCapsCache();
    vi.mocked(createRuntimeClient).mockReturnValue(mockRuntime as never);
});

describe('search-notes: index path', () => {
    beforeEach(() => {
        vi.mocked(api.listNotesAPI).mockResolvedValue([
            { name: 'alpha.md', perm: 'rw' },
            { name: 'beta.md', perm: 'rw' },
        ] as never);
        vi.mocked(cache.getCachedNoteContent).mockImplementation(async (filename: unknown) => {
            if (filename === 'alpha.md') return 'the keyword lives here\n';
            return 'nothing relevant\n';
        });
        mockRuntime.probeCapabilities.mockResolvedValue({
            ok: true,
            caps: { basicSearch: true, silversearch: false, query: true },
        });
        mockRuntime.fulltextSearch.mockResolvedValue({
            ok: true,
            results: [{ file: 'alpha.md', score: 5 }],
        });
    });

    it('ranks via the index and extracts line matches for the page window only', async () => {
        const res = await captureTool('search-notes')(baseArgs);
        const text = res.content[0].text;
        expect(text).toContain('SEARCH: "keyword"');
        expect(text).toContain('alpha.md');
        expect(text).toContain('L1: the keyword lives here');
        expect(mockRuntime.fulltextSearch).toHaveBeenCalledWith('keyword', 'basic');
        // Only the index-selected note is read for line extraction.
        expect(vi.mocked(cache.getCachedNoteContent)).toHaveBeenCalledWith('alpha.md', false);
        expect(vi.mocked(cache.getCachedNoteContent)).not.toHaveBeenCalledWith('beta.md', false);
    });

    it('labels the output with the search source', async () => {
        const res = await captureTool('search-notes')(baseArgs);
        expect(res.content[0].text).toContain('via full-text index');
    });

    it('falls back to scan when the index search fails, with a notice', async () => {
        mockRuntime.fulltextSearch.mockResolvedValue({ ok: false, error: 'index corrupted' });
        const res = await captureTool('search-notes')(baseArgs);
        const text = res.content[0].text;
        expect(text).toContain('via full scan');
        expect(text).toContain('index corrupted');
        expect(text).toContain('alpha.md'); // scan still finds it
    });
});

describe('search-notes: fallback to scan', () => {
    beforeEach(() => {
        vi.mocked(api.listNotesAPI).mockResolvedValue([{ name: 'alpha.md', perm: 'rw' }] as never);
        vi.mocked(cache.getCachedNoteContent).mockResolvedValue('the keyword lives here\n');
    });

    it('scans silently when the runtime is unavailable', async () => {
        mockRuntime.probeCapabilities.mockResolvedValue({ ok: false, error: 'runtime API not available (HTTP 404)' });
        const res = await captureTool('search-notes')(baseArgs);
        const text = res.content[0].text;
        expect(text).toContain('via full scan');
        expect(text).toContain('alpha.md');
        expect(mockRuntime.fulltextSearch).not.toHaveBeenCalled();
    });

    it('scans when no search library is installed', async () => {
        mockRuntime.probeCapabilities.mockResolvedValue({
            ok: true,
            caps: { basicSearch: false, silversearch: false, query: true },
        });
        const res = await captureTool('search-notes')(baseArgs);
        expect(res.content[0].text).toContain('via full scan');
    });

    it('validates wrong zero-results and falls back to scan', async () => {
        mockRuntime.probeCapabilities.mockResolvedValue({
            ok: true,
            caps: { basicSearch: true, silversearch: false, query: true },
        });
        mockRuntime.fulltextSearch.mockResolvedValue({ ok: true, results: [] });
        const res = await captureTool('search-notes')(baseArgs);
        const text = res.content[0].text;
        expect(text).toContain('via full scan');
        expect(text).toContain('alpha.md');
    });

    it('trusts genuine zero results', async () => {
        vi.mocked(cache.getCachedNoteContent).mockResolvedValue('nothing here\n');
        mockRuntime.probeCapabilities.mockResolvedValue({
            ok: true,
            caps: { basicSearch: true, silversearch: false, query: true },
        });
        mockRuntime.fulltextSearch.mockResolvedValue({ ok: true, results: [] });
        const res = await captureTool('search-notes')(baseArgs);
        const text = res.content[0].text;
        expect(text).toContain('No matches found for "keyword"');
        expect(text).toContain('full-text index');
    });
});

describe('search-notes: existing behavior preserved (AC5)', () => {
    beforeEach(() => {
        vi.mocked(api.listNotesAPI).mockResolvedValue([{ name: 'multi.md', perm: 'rw' }] as never);
        vi.mocked(cache.getCachedNoteContent).mockResolvedValue(
            'Line 1: Hello world\nLine 2: This is a test\nLine 3: More content here\nLine 4: Final line'
        );
        mockRuntime.probeCapabilities.mockResolvedValue({ ok: false, error: 'unavailable' });
    });

    it('scan path keeps the exact output format (title match, ranking, pagination footer)', async () => {
        vi.mocked(api.listNotesAPI).mockResolvedValue([
            { name: 'a.md', perm: 'rw' },
            { name: 'b.md', perm: 'rw' },
        ] as never);
        vi.mocked(cache.getCachedNoteContent).mockImplementation(async (filename: unknown) =>
            filename === 'a.md' ? 'hit\nnext\n' : 'hit\nnext\n'
        );
        const res = await captureTool('search-notes')({ ...baseArgs, query: 'hit' });
        const text = res.content[0].text;
        expect(text).toBe(
            'SEARCH: "hit" | Results: 2 notes, 2 matches | Page 1/1 | via full scan\n\n' +
                '1. a.md (1x)\n  • L1: hit\n      2: next\n\n' +
                '2. b.md (1x)\n  • L1: hit\n      2: next\n\n'
        );
    });

    it('regex invalid fallback warning is preserved when results exist', async () => {
        vi.mocked(cache.getCachedNoteContent).mockResolvedValue('a** pattern here\n');
        const res = await captureTool('search-notes')({ ...baseArgs, query: 'a**' });
        expect(res.content[0].text).toContain('Warning: Your regex query "a**" was invalid');
        expect(res.content[0].text).toContain('a** pattern here');
    });
});
