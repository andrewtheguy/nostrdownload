/**
 * Nostr protocol utilities for fetching nostrsave data
 */

import { SimplePool } from 'nostr-tools/pool';
import type { Filter } from 'nostr-tools';
import { EVENT_KINDS, D_TAGS, type FileIndex, type Manifest, type ChunkInfo } from './types';

/**
 * Default relays for index data
 * These are commonly used nostr relays that support parameterized replaceable events
 */
export const DEFAULT_INDEX_RELAYS = [
    'wss://nos.lol',
    //'wss://relay.damus.io',
    //'wss://relay.nostr.band',
    'wss://relay.nostr.net',
    'wss://relay.primal.net',
    'wss://relay.snort.social',
];

/**
 * Create a SimplePool with recommended settings
 */
export function createPool(): SimplePool {
    return new SimplePool();
}

/**
 * Calculate d-tag for a specific page number
 * Page 1 = current index
 * Page N > 1 = archive (total_archives + 2 - page)
 */
export function getDTagForPage(page: number, totalArchives: number): string {
    if (page === 1) {
        return D_TAGS.CURRENT_INDEX;
    }
    const archiveNumber = totalArchives + 2 - page;
    return D_TAGS.archiveTag(archiveNumber);
}

/**
 * Fetch file index for a specific page
 * Page 1 is the current index, subsequent pages are archives
 */
export async function fetchFileIndex(
    pool: SimplePool,
    relays: string[],
    pubkey: string,
    page: number = 1
): Promise<FileIndex | null> {
    // For page 1, we need to first fetch to get total_archives
    // For other pages, we need to know total_archives to calculate the correct d-tag

    if (page === 1) {
        // Fetch current index
        const filter: Filter = {
            kinds: [EVENT_KINDS.INDEX],
            authors: [pubkey],
            '#d': [D_TAGS.CURRENT_INDEX],
            limit: 1,
        };

        const events = await pool.querySync(relays, filter);
        if (events.length === 0) return null;

        // Get most recent event
        const event = events.reduce((a, b) =>
            a.created_at > b.created_at ? a : b
        );

        let index: FileIndex;
        try {
            index = JSON.parse(event.content) as FileIndex;
        } catch {
            console.error('Failed to parse index content');
            return null;
        }
        if (index.version !== 2) {
            throw new Error(`Unsupported index version ${index.version}. Only version 2 is supported.`);
        }
        return index;
    } else {
        // For archive pages, we need to fetch page 1 first to get total_archives
        const currentIndex = await fetchFileIndex(pool, relays, pubkey, 1);
        if (!currentIndex) return null;

        const dTag = getDTagForPage(page, currentIndex.total_archives);

        const filter: Filter = {
            kinds: [EVENT_KINDS.INDEX],
            authors: [pubkey],
            '#d': [dTag],
            limit: 1,
        };

        const events = await pool.querySync(relays, filter);
        if (events.length === 0) return null;

        const event = events.reduce((a, b) =>
            a.created_at > b.created_at ? a : b
        );

        let index: FileIndex;
        try {
            index = JSON.parse(event.content) as FileIndex;
        } catch {
            console.error('Failed to parse archive content');
            return null;
        }
        if (index.version !== 2) {
            throw new Error(`Unsupported index version ${index.version}. Only version 2 is supported.`);
        }
        return index;
    }
}

/**
 * Fetch manifest for a specific file
 */
export async function fetchManifest(
    pool: SimplePool,
    relays: string[],
    pubkey: string,
    fileHash: string
): Promise<Manifest | null> {
    console.log('[fetchManifest] Querying for:', { fileHash, pubkey, relays });

    const filters: Filter[] = [
        {
            kinds: [EVENT_KINDS.MANIFEST],
            authors: [pubkey],
            '#x': [fileHash],
            limit: 1,
        },
        {
            kinds: [EVENT_KINDS.MANIFEST],
            authors: [pubkey],
            '#d': [fileHash],
            limit: 1,
        },
    ];

    let events: Awaited<ReturnType<typeof pool.querySync>> = [];
    for (const filter of filters) {
        console.log('[fetchManifest] Filter:', filter);
        events = await pool.querySync(relays, filter);
        console.log('[fetchManifest] Got events:', events.length);
        if (events.length > 0) break;
    }

    if (events.length === 0) return null;

    const event = events.reduce((a, b) =>
        a.created_at > b.created_at ? a : b
    );

    let manifest: Manifest;
    try {
        manifest = JSON.parse(event.content) as Manifest;
    } catch {
        console.error('Failed to parse manifest content');
        return null;
    }
    if (manifest.version !== 2) {
        throw new Error(`Unsupported manifest version ${manifest.version}. Only version 2 is supported.`);
    }
    console.log('[fetchManifest] Parsed manifest:', {
        file_name: manifest.file_name,
        total_chunks: manifest.total_chunks,
        relays: manifest.relays,
        encryption: manifest.encryption,
    });
    return manifest;
}

/**
 * Chunk event with content
 */
export interface ChunkEvent {
    index: number;
    content: string;
    encryption: string;
}

type ChunkCacheEntry = {
    chunksByIndex: Map<number, ChunkEvent>;
    inFlight?: Promise<ChunkEvent[]>;
};

const chunkCache = new Map<string, ChunkCacheEntry>();

const CHUNK_ID_BATCH_SIZE = 200;
const CHUNK_FETCH_MAX_WAIT_MS = 4000;

async function fetchChunkEventsWithFilters(
    pool: SimplePool,
    relays: string[],
    filters: Filter[],
    onEvent: (event: { id: string; tags: string[][]; content: string }) => void,
    shouldStop: () => boolean
): Promise<void> {
    return new Promise((resolve) => {
        if (filters.length === 0) {
            resolve();
            return;
        }

        let resolved = false;
        let remaining = filters.length;
        const subs = filters.map((filter) => pool.subscribeManyEose(relays, filter, {
            onevent(event) {
                onEvent(event);
                if (!resolved && shouldStop()) {
                    resolved = true;
                    subs.forEach((sub) => sub.close('all chunks collected'));
                    resolve();
                }
            },
            onclose() {
                remaining -= 1;
                if (!resolved && remaining <= 0) {
                    resolved = true;
                    resolve();
                }
            },
            maxWait: CHUNK_FETCH_MAX_WAIT_MS
        }));
    });
}

function parseChunkIndexFromTags(tags: string[][]): number | null {
    const chunkTag = tags.find(t => t[0] === 'chunk');
    if (chunkTag && chunkTag[1]) {
        const index = parseInt(chunkTag[1], 10);
        if (!Number.isNaN(index)) return index;
    }

    const dTag = tags.find(t => t[0] === 'd')?.[1];
    if (!dTag) return null;

    const parts = dTag.split(':');
    const indexStr = parts[parts.length - 1];
    const index = parseInt(indexStr, 10);
    return Number.isNaN(index) ? null : index;
}

/**
 * Fetch all chunks for a file
 * Returns chunks in order by index
 */
export async function fetchChunks(
    pool: SimplePool,
    relays: string[],
    pubkey: string,
    fileHash: string,
    totalChunks: number,
    onProgress?: (fetched: number, total: number) => void,
    chunkInfos?: ChunkInfo[]
): Promise<ChunkEvent[]> {
    const cacheKey = `${pubkey}:${fileHash}`;
    const cached = chunkCache.get(cacheKey);

    if (cached?.chunksByIndex && cached.chunksByIndex.size === totalChunks) {
        return Array.from(cached.chunksByIndex.values()).sort((a, b) => a.index - b.index);
    }

    if (cached?.inFlight) {
        await cached.inFlight;
        const ready = chunkCache.get(cacheKey);
        if (ready?.chunksByIndex && ready.chunksByIndex.size === totalChunks) {
            return Array.from(ready.chunksByIndex.values()).sort((a, b) => a.index - b.index);
        }
    }

    const chunksByIndex = new Map<number, ChunkEvent>(cached?.chunksByIndex ?? []);
    const seenEventIds = new Set<string>();

    console.log('[fetchChunks] Querying for:', { fileHash, pubkey, relays, totalChunks });

    const indexByEventId = new Map<string, number>();
    if (chunkInfos && chunkInfos.length > 0) {
        for (const info of chunkInfos) {
            if (info?.event_id) indexByEventId.set(info.event_id, info.index);
        }
    }

    if (chunksByIndex.size > 0) {
        onProgress?.(chunksByIndex.size, totalChunks);
    }

    const fetchPromise = (async () => {
        const handleEvent = (event: { id: string; tags: string[][]; content: string }) => {
            if (seenEventIds.has(event.id)) return;
            seenEventIds.add(event.id);

            const parsedIndex = parseChunkIndexFromTags(event.tags);
            const index = parsedIndex ?? indexByEventId.get(event.id);
            if (index == null) return;

            // Get encryption type from tags
            const encryptionTag = event.tags.find(t => t[0] === 'encryption');
            const encryption = encryptionTag?.[1] || 'none';

            if (!chunksByIndex.has(index)) {
                const chunk = {
                    index,
                    content: event.content,
                    encryption,
                };
                chunksByIndex.set(index, chunk);
                const entry = chunkCache.get(cacheKey);
                if (entry) entry.chunksByIndex.set(index, chunk);
                onProgress?.(chunksByIndex.size, totalChunks);
            }
        };

        if (indexByEventId.size > 0) {
            console.log('[fetchChunks] Using manifest event ids:', indexByEventId.size);
            const ids = Array.from(indexByEventId.keys());

            for (let i = 0; i < ids.length; i += CHUNK_ID_BATCH_SIZE) {
                const batch = ids.slice(i, i + CHUNK_ID_BATCH_SIZE);
                const filter: Filter = {
                    kinds: [EVENT_KINDS.CHUNK],
                    authors: [pubkey],
                    ids: batch,
                };
                console.log('[fetchChunks] Filter (ids batch):', filter);

                await fetchChunkEventsWithFilters(
                    pool,
                    relays,
                    [filter],
                    handleEvent,
                    () => chunksByIndex.size >= totalChunks
                );

                if (chunksByIndex.size >= totalChunks) {
                    break;
                }
            }
        }

        if (chunksByIndex.size < totalChunks) {
            // Fetch remaining chunks for this file using the x tag
            const filter: Filter = {
                kinds: [EVENT_KINDS.CHUNK],
                authors: [pubkey],
                '#x': [fileHash],
            };
            console.log('[fetchChunks] Filter (fallback #x):', filter);

            await fetchChunkEventsWithFilters(
                pool,
                relays,
                [filter],
                handleEvent,
                () => chunksByIndex.size >= totalChunks
            );
        }

        return Array.from(chunksByIndex.values()).sort((a, b) => a.index - b.index);
    })();

    const entry = cached ?? { chunksByIndex: new Map<number, ChunkEvent>() };
    entry.inFlight = fetchPromise;
    if (!cached) {
        chunkCache.set(cacheKey, entry);
    }

    let chunks: ChunkEvent[];
    try {
        chunks = await fetchPromise;
    } finally {
        const current = chunkCache.get(cacheKey);
        if (current) current.inFlight = undefined;
    }

    console.log('[fetchChunks] Returning chunks:', chunks.length);
    return chunks;
}

/**
 * Close pool and clean up connections
 */
export function closePool(pool: SimplePool): void {
    pool.close(DEFAULT_INDEX_RELAYS);
}
