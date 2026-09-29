/**
 * Tests for runtime-client.ts — Runtime API client.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { createRuntimeClient, luaEscape } from '../runtime-client.js';

function jsonResponse(status: number, body: unknown) {
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('probeCapabilities', () => {
    it('posts the probe with auth, content-type and X-Timeout headers', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { result: { basicSearch: true, silversearch: false, query: true } }));
        vi.stubGlobal('fetch', fetchMock);
        const client = createRuntimeClient('http://sb:3000/', 'tok');
        const out = await client.probeCapabilities(45000);
        expect(out).toEqual({ ok: true, caps: { basicSearch: true, silversearch: false, query: true } });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('http://sb:3000/.runtime/lua_script');
        expect((init as RequestInit).method).toBe('POST');
        expect((init as RequestInit).headers).toMatchObject({
            'Content-Type': 'text/plain',
            'X-Timeout': '45',
            Authorization: 'Bearer tok',
        });
    });

    it('works without a token', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { result: { basicSearch: false, silversearch: false, query: true } }));
        vi.stubGlobal('fetch', fetchMock);
        const client = createRuntimeClient('http://sb:3000');
        const out = await client.probeCapabilities();
        expect(out).toEqual({ ok: true, caps: { basicSearch: false, silversearch: false, query: true } });
        expect((fetchMock.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty('Authorization');
    });

    it('classifies 404 as unavailable', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(404, 'not found')));
        const client = createRuntimeClient('http://sb:3000', 'tok');
        const out = await client.probeCapabilities();
        expect(out).toMatchObject({ ok: false, kind: 'unavailable' });
    });

    it('classifies 401 as auth', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: 'unauthorized' })));
        const client = createRuntimeClient('http://sb:3000', 'tok');
        const out = await client.probeCapabilities();
        expect(out).toMatchObject({ ok: false, kind: 'auth' });
    });

    it('classifies the Lua error envelope as an error', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { error: 'index corrupted' })));
        const client = createRuntimeClient('http://sb:3000', 'tok');
        const out = await client.probeCapabilities();
        expect(out).toMatchObject({ ok: false, kind: 'error', error: 'index corrupted' });
    });

    it('classifies malformed JSON as an error', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, 'not json')));
        const client = createRuntimeClient('http://sb:3000', 'tok');
        const out = await client.probeCapabilities();
        expect(out).toMatchObject({ ok: false, kind: 'error' });
    });

    it('rejects unexpected probe shapes', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { result: null })));
        const client = createRuntimeClient('http://sb:3000', 'tok');
        const out = await client.probeCapabilities();
        expect(out).toMatchObject({ ok: false, kind: 'error', error: /probe response shape/ });
    });

    it('classifies network failures as unavailable', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
        const client = createRuntimeClient('http://sb:3000', 'tok');
        const out = await client.probeCapabilities();
        expect(out).toMatchObject({ ok: false, kind: 'unavailable' });
    });

    it('classifies aborts as timeout', async () => {
        const abortError = new Error('The operation was aborted');
        abortError.name = 'TimeoutError';
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));
        const client = createRuntimeClient('http://sb:3000', 'tok');
        const out = await client.probeCapabilities();
        expect(out).toMatchObject({ ok: false, kind: 'timeout' });
    });
});

describe('fulltextSearch', () => {
    it('normalizes basic-search results (id -> file, .md appended)', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            jsonResponse(200, { result: [{ id: 'notes/alpha', score: 7 }, { id: 'beta.md', score: 3 }] })
        );
        vi.stubGlobal('fetch', fetchMock);
        const client = createRuntimeClient('http://sb:3000', 'tok');
        const out = await client.fulltextSearch('alpha', 'basic');
        expect(out).toEqual({
            ok: true,
            results: [
                { file: 'notes/alpha.md', score: 7 },
                { file: 'beta.md', score: 3 },
            ],
        });
        const body = (fetchMock.mock.calls[0][1] as RequestInit).body as string;
        expect(body).toBe("return search.ftsSearch('alpha')");
    });

    it('normalizes silversearch results (name -> file) and sorts by score', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            jsonResponse(200, { result: [{ name: 'gamma', score: 2 }, { name: 'delta', score: 9 }] })
        );
        vi.stubGlobal('fetch', fetchMock);
        const client = createRuntimeClient('http://sb:3000', 'tok');
        const out = await client.fulltextSearch('gamma', 'silver');
        expect(out).toEqual({
            ok: true,
            results: [
                { file: 'delta.md', score: 9 },
                { file: 'gamma.md', score: 2 },
            ],
        });
        const body = (fetchMock.mock.calls[0][1] as RequestInit).body as string;
        expect(body).toBe("return silversearch.search('gamma', {silent = true})");
    });

    it('escapes Lua metacharacters in the term', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { result: [] }));
        vi.stubGlobal('fetch', fetchMock);
        const client = createRuntimeClient('http://sb:3000', 'tok');
        await client.fulltextSearch("it's a \\ test", 'basic');
        const body = (fetchMock.mock.calls[0][1] as RequestInit).body as string;
        expect(body).toBe("return search.ftsSearch('it\\'s a \\\\ test')");
    });

    it('drops malformed rows and tolerates non-array results', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            jsonResponse(200, { result: [{ id: 'ok', score: 1 }, { score: 5 }, { id: '', score: 2 }, null] })
        );
        vi.stubGlobal('fetch', fetchMock);
        const client = createRuntimeClient('http://sb:3000', 'tok');
        const out = await client.fulltextSearch('x', 'basic');
        expect(out).toEqual({ ok: true, results: [{ file: 'ok.md', score: 1 }] });
    });

    it('propagates search failures', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { error: 'boom' })));
        const client = createRuntimeClient('http://sb:3000', 'tok');
        const out = await client.fulltextSearch('x', 'basic');
        expect(out).toEqual({ ok: false, error: 'boom' });
    });

    it('rejects unknown engines without contacting the server', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const client = createRuntimeClient('http://sb:3000', 'tok');
        const out = await client.fulltextSearch('x', 'bogus' as 'basic');
        expect(out).toEqual({ ok: false, error: 'unknown search engine: bogus' });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('luaEscape', () => {
    it('escapes backslashes, quotes, newlines, carriage returns and NULs', () => {
        expect(luaEscape("a'b\\c\nd\r\re\0f")).toBe("a\\'b\\\\c\\nd\\r\\re\\0f");
    });
});
