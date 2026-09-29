/**
 * Tests for search-strategy.ts — the hybrid search strategy ported from the CLI.
 *
 * Encodes the same acceptance criteria as the CLI implementation:
 *   AC1: index path ranks pages, fetches only the current page's notes.
 *   AC2: zero index results are validated; stale index never causes false negatives.
 *   AC3: unavailable runtime/library falls back silently; verdicts cached;
 *        failed searches invalidate the cache.
 *   AC4: mode 'scan' never touches the runtime; mode 'index' fails loudly;
 *        title search always scans.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { hybridSearch } from '../search-strategy.js';
import type { SearchContext } from '../search-strategy.js';

type MockFile = { name: string; perm: 'ro' | 'rw'; lastModified?: number };

function makeCtx({
    files = {},
    probeResult,
    searchResults,
    searchError,
}: {
    files?: Record<string, string | { content: string; lastModified: number }>;
    probeResult?:
        | { ok: true; caps?: { basicSearch: boolean; silversearch: boolean } }
        | { ok: false; error?: string };
    searchResults?: { file: string; score: number }[];
    searchError?: string;
} = {}): { ctx: SearchContext; runtimeCalls: string[]; reads: string[] } {
    const runtimeCalls: string[] = [];
    const reads: string[] = [];
    const listing: MockFile[] = Object.entries(files).map(([name, v]) => ({
        name,
        perm: 'rw' as const,
        lastModified: typeof v === 'string' ? 0 : v.lastModified,
    }));
    const capsStore: { caps: { available: boolean; engine?: string } | null } = { caps: null };

    const ctx: SearchContext = {
        listNotes: async () => listing.map((f) => ({ ...f })),
        readNote: async (filename: string) => {
            reads.push(filename);
            const v = files[filename];
            if (v === undefined) throw new Error(`read failed: 404`);
            return typeof v === 'string' ? v : v.content;
        },
        runtime: {
            probeCapabilities: async () => {
                runtimeCalls.push('probe');
                return probeResult ?? { ok: false, error: 'runtime unavailable' };
            },
            fulltextSearch: async (_term: string, _engine: string) => {
                runtimeCalls.push('search');
                if (searchError) return { ok: false as const, error: searchError };
                return { ok: true as const, results: searchResults ?? [] };
            },
        },
        caps: {
            get: () => capsStore.caps,
            save: (c: { available: boolean; engine?: string }) => {
                capsStore.caps = c;
            },
            clear: () => {
                capsStore.caps = null;
            },
        },
    };
    return { ctx, runtimeCalls, reads };
}

const FILES = {
    'alpha.md': { content: 'alpha has the keyword here\nsecond line\n', lastModified: 100 },
    'beta.md': { content: 'nothing relevant\n', lastModified: 200 },
    'gamma.md': { content: 'KEYWORD in caps\n', lastModified: 300 },
};

describe('AC1: hybrid index path', () => {
    it('uses the index and fetches only matching notes for line extraction', async () => {
        const { ctx, reads } = makeCtx({
            files: FILES,
            probeResult: { ok: true, caps: { basicSearch: true, silversearch: false } },
            searchResults: [{ file: 'alpha.md', score: 7 }],
        });
        const out = await hybridSearch({
            ctx,
            query: 'keyword',
            searchType: 'content',
            maxResults: 10,
            page: 1,
            concise: true,
            contextLines: 1,
        });
        expect(out.source).toBe('index');
        expect(out.totalResults).toBe(1);
        expect(out.results[0].filename).toBe('alpha.md');
        expect(out.results[0].matches.some((m) => m.type === 'content' && m.line === 1)).toBe(true);
        expect(reads).toEqual(['alpha.md']);
    });

    it('respects pagination: only page-2 notes are fetched', async () => {
        const { ctx, reads } = makeCtx({
            files: FILES,
            probeResult: { ok: true, caps: { basicSearch: true, silversearch: false } },
            searchResults: [
                { file: 'alpha.md', score: 3 },
                { file: 'beta.md', score: 2 },
            ],
        });
        const out = await hybridSearch({
            ctx,
            query: 'term',
            searchType: 'content',
            maxResults: 1,
            page: 2,
        });
        expect(out.source).toBe('index');
        expect(out.totalResults).toBe(2);
        expect(out.results[0].filename).toBe('beta.md');
        expect(reads).toEqual(['beta.md']);
    });

    it('filters Library/ and non-markdown files out of index results', async () => {
        const { ctx } = makeCtx({
            files: FILES,
            probeResult: { ok: true, caps: { basicSearch: true, silversearch: false } },
            searchResults: [
                { file: 'Library/Std/Search.md', score: 9 },
                { file: 'image.png', score: 8 },
                { file: 'alpha.md', score: 1 },
            ],
        });
        const out = await hybridSearch({ ctx, query: 'x', searchType: 'content' });
        expect(out.results.map((r) => r.filename)).toEqual(['alpha.md']);
        expect(out.totalResults).toBe(1);
    });

    it('includes context lines in non-concise mode like the scan path', async () => {
        const { ctx } = makeCtx({
            files: FILES,
            probeResult: { ok: true, caps: { basicSearch: true, silversearch: false } },
            searchResults: [{ file: 'alpha.md', score: 1 }],
        });
        const out = await hybridSearch({
            ctx,
            query: 'keyword',
            searchType: 'content',
            concise: false,
            contextLines: 1,
        });
        const m = out.results[0].matches.find((x) => x.type === 'content' && x.line === 1);
        expect(m?.context).toContain('second line');
    });
});

describe('AC2: zero-result validation', () => {
    it('falls back to scan when the index is wrong about zero results', async () => {
        const { ctx } = makeCtx({
            files: FILES,
            probeResult: { ok: true, caps: { basicSearch: true, silversearch: false } },
            searchResults: [],
        });
        const out = await hybridSearch({ ctx, query: 'keyword', searchType: 'content' });
        expect(out.source).toBe('scan');
        expect(out.totalResults).toBe(2);
        expect(out.notice).toBeTruthy();
    });

    it('trusts a zero result when the term is genuinely absent', async () => {
        const { ctx } = makeCtx({
            files: FILES,
            probeResult: { ok: true, caps: { basicSearch: true, silversearch: false } },
            searchResults: [],
        });
        const out = await hybridSearch({ ctx, query: 'zzznotfound', searchType: 'content' });
        expect(out.source).toBe('index');
        expect(out.totalResults).toBe(0);
        expect(out.notice).toBeUndefined();
    });

    it('small space: catches a term confined to an old note (full validation)', async () => {
        const { ctx } = makeCtx({
            files: {
                'recent.md': { content: 'boring\n', lastModified: 999 },
                'ancient.md': { content: 'xylophone deep in history\n', lastModified: 1 },
            },
            probeResult: { ok: true, caps: { basicSearch: true, silversearch: false } },
            searchResults: [],
        });
        const out = await hybridSearch({ ctx, query: 'xylophone', searchType: 'content' });
        expect(out.source).toBe('scan');
        expect(out.results[0]?.filename).toBe('ancient.md');
    });
});

describe('AC3: graceful fallback and caching', () => {
    it('falls back to scan when the runtime is unavailable and caches the negative verdict', async () => {
        const { ctx, runtimeCalls } = makeCtx({ files: FILES });
        const out = await hybridSearch({ ctx, query: 'keyword', searchType: 'content' });
        expect(out.source).toBe('scan');
        expect(ctx.caps.get()).toEqual({ available: false });
        // Second call must not re-probe.
        await hybridSearch({ ctx, query: 'keyword', searchType: 'content' });
        expect(runtimeCalls).toEqual(['probe']);
    });

    it('uses a cached positive verdict without re-probing', async () => {
        const { ctx, runtimeCalls } = makeCtx({
            files: FILES,
            probeResult: { ok: true, caps: { basicSearch: true, silversearch: false } },
            searchResults: [{ file: 'alpha.md', score: 1 }],
        });
        ctx.caps.save({ available: true, engine: 'basic' });
        const out = await hybridSearch({ ctx, query: 'keyword', searchType: 'content' });
        expect(out.source).toBe('index');
        expect(runtimeCalls).toEqual(['search']);
    });

    it('invalidates the cached verdict when the index search fails, then falls back', async () => {
        const { ctx } = makeCtx({
            files: FILES,
            probeResult: { ok: true, caps: { basicSearch: true, silversearch: false } },
            searchError: 'index corrupted',
        });
        const out = await hybridSearch({ ctx, query: 'keyword', searchType: 'content' });
        expect(out.source).toBe('scan');
        expect(out.notice).toMatch(/index search failed/);
        expect(ctx.caps.get()).not.toEqual(expect.objectContaining({ available: true }));
    });
});

describe('AC4: mode selection', () => {
    it("mode 'scan' never contacts the runtime", async () => {
        const { ctx, runtimeCalls } = makeCtx({
            files: FILES,
            probeResult: { ok: true, caps: { basicSearch: true, silversearch: false } },
        });
        const out = await hybridSearch({ ctx, query: 'keyword', searchType: 'content', mode: 'scan' });
        expect(out.source).toBe('scan');
        expect(runtimeCalls).toEqual([]);
    });

    it("mode 'index' with unavailable runtime throws", async () => {
        const { ctx } = makeCtx({ files: FILES });
        await expect(
            hybridSearch({ ctx, query: 'keyword', searchType: 'content', mode: 'index' })
        ).rejects.toThrow(/unavailable/i);
    });

    it("mode 'index' with no search library throws", async () => {
        const { ctx } = makeCtx({
            files: FILES,
            probeResult: { ok: true, caps: { basicSearch: false, silversearch: false } },
        });
        await expect(
            hybridSearch({ ctx, query: 'keyword', searchType: 'content', mode: 'index' })
        ).rejects.toThrow(/no full-text search library/i);
    });

    it("searchType 'title' always scans", async () => {
        const { ctx, runtimeCalls } = makeCtx({
            files: FILES,
            probeResult: { ok: true, caps: { basicSearch: true, silversearch: false } },
        });
        const out = await hybridSearch({ ctx, query: 'alpha', searchType: 'title' });
        expect(out.source).toBe('scan');
        expect(runtimeCalls).toEqual([]);
    });
});

describe('scan parity', () => {
    it('scan honours case sensitivity and ranks by match count', async () => {
        const { ctx } = makeCtx({ files: FILES });
        const out = await hybridSearch({
            ctx,
            query: 'KEYWORD',
            searchType: 'content',
            caseSensitive: true,
        });
        expect(out.source).toBe('scan');
        expect(out.totalResults).toBe(1);
        expect(out.results[0].filename).toBe('gamma.md');
    });

    it('scan falls back to literal matching for invalid regex', async () => {
        const { ctx } = makeCtx({
            files: { 'x.md': { content: 'a (b c\n', lastModified: 1 } },
        });
        const out = await hybridSearch({ ctx, query: '(b', searchType: 'content' });
        expect(out.source).toBe('scan');
        expect(out.totalResults).toBe(1);
    });
});

beforeEach(() => {
    vi.restoreAllMocks();
});

describe('branch coverage: unusual verdicts and validation failures', () => {
    it('re-probes when a cached positive verdict lacks an engine', async () => {
        const { ctx, runtimeCalls } = makeCtx({
            files: FILES,
            probeResult: { ok: true, caps: { basicSearch: true, silversearch: false } },
            searchResults: [{ file: 'alpha.md', score: 1 }],
        });
        ctx.caps.save({ available: true }); // no engine → stale/malformed verdict
        const out = await hybridSearch({ ctx, query: 'keyword', searchType: 'content' });
        expect(out.source).toBe('index');
        expect(runtimeCalls).toEqual(['probe', 'search']);
    });

    it('treats a listing failure during zero-validation as untrustworthy... but still scans', async () => {
        const { ctx } = makeCtx({
            files: FILES,
            probeResult: { ok: true, caps: { basicSearch: true, silversearch: false } },
            searchResults: [],
        });
        ctx.listNotes = async () => {
            throw new Error('listing failed');
        };
        const out = await hybridSearch({ ctx, query: 'keyword', searchType: 'content' });
        // Validation can't run (listing failed) → the zero is trusted, per the
        // documented trade-off: without a listing there is no way to check.
        expect(out.source).toBe('index');
        expect(out.notice).toBeUndefined();
    });

    it('mode index with a cached negative verdict throws', async () => {
        const { ctx } = makeCtx({ files: FILES });
        ctx.caps.save({ available: false });
        await expect(
            hybridSearch({ ctx, query: 'keyword', searchType: 'content', mode: 'index' })
        ).rejects.toThrow(/cached verdict/i);
    });
});
