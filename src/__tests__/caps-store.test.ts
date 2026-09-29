/**
 * Tests for caps-store.ts — in-memory capability verdict cache.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { loadCaps, saveCaps, clearCaps, resetCapsCache } from '../caps-store.js';

afterEach(() => {
    vi.useRealTimers();
    resetCapsCache();
});

describe('caps-store', () => {
    it('round-trips a verdict', () => {
        saveCaps('http://a', { available: true, engine: 'basic' });
        expect(loadCaps('http://a')).toEqual({ available: true, engine: 'basic' });
    });

    it('returns null for unknown base URLs', () => {
        expect(loadCaps('http://never')).toBeNull();
    });

    it('keys by base URL', () => {
        saveCaps('http://a', { available: true, engine: 'basic' });
        saveCaps('http://b', { available: false });
        expect(loadCaps('http://a')?.engine).toBe('basic');
        expect(loadCaps('http://b')?.available).toBe(false);
    });

    it('expires entries after the TTL', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
        saveCaps('http://a', { available: true, engine: 'basic' });
        // Just under the TTL: fresh.
        vi.setSystemTime(new Date('2025-01-01T00:09:59Z'));
        expect(loadCaps('http://a')).not.toBeNull();
        // Past the TTL: expired (and evicted).
        vi.setSystemTime(new Date('2025-01-01T00:10:01Z'));
        expect(loadCaps('http://a')).toBeNull();
    });

    it('clear removes the verdict and tolerates unknown keys', () => {
        saveCaps('http://a', { available: true });
        clearCaps('http://a');
        expect(loadCaps('http://a')).toBeNull();
        expect(() => clearCaps('http://never')).not.toThrow();
    });

    it('resetCapsCache drops everything', () => {
        saveCaps('http://a', { available: true });
        saveCaps('http://b', { available: false });
        resetCapsCache();
        expect(loadCaps('http://a')).toBeNull();
        expect(loadCaps('http://b')).toBeNull();
    });
});
