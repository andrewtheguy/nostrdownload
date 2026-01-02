/**
 * Key management utilities for nostr
 * Handles nsec/npub conversion with secure erasure
 */

import * as nip19 from 'nostr-tools/nip19';
import { getPublicKey } from 'nostr-tools/pure';

/**
 * Decode an nsec string to a secret key Uint8Array
 * @throws Error if nsec is invalid
 */
export function nsecToSecretKey(nsec: string): Uint8Array {
    const decoded = nip19.decode(nsec);
    if (decoded.type !== 'nsec') {
        throw new Error('Invalid nsec format');
    }
    return decoded.data;
}

/**
 * Decode an npub string to a hex public key
 * @throws Error if npub is invalid
 */
export function npubToPublicKey(npub: string): string {
    const decoded = nip19.decode(npub);
    if (decoded.type !== 'npub') {
        throw new Error('Invalid npub format');
    }
    return decoded.data;
}

/**
 * Derive public key (hex) from a secret key
 */
export function getPublicKeyFromSecret(sk: Uint8Array): string {
    return getPublicKey(sk);
}

/**
 * Encode a hex public key to npub format
 */
export function publicKeyToNpub(pubkeyHex: string): string {
    return nip19.npubEncode(pubkeyHex);
}

/**
 * Securely clear a secret key from memory
 * Note: JavaScript strings are immutable, so we can only zero Uint8Arrays
 */
export function clearSecretKey(sk: Uint8Array): void {
    sk.fill(0);
}

/**
 * Validate if a string is a valid npub
 */
export function isValidNpub(input: string): boolean {
    if (!input.startsWith('npub1')) return false;
    try {
        const decoded = nip19.decode(input);
        return decoded.type === 'npub';
    } catch {
        return false;
    }
}

/**
 * Validate if a string is a valid nsec
 */
export function isValidNsec(input: string): boolean {
    if (!input.startsWith('nsec1')) return false;
    try {
        const decoded = nip19.decode(input);
        return decoded.type === 'nsec';
    } catch {
        return false;
    }
}

/**
 * Check if input is a valid hex public key (64 chars)
 */
export function isValidHexPubkey(input: string): boolean {
    return /^[0-9a-fA-F]{64}$/.test(input);
}

/**
 * Normalize any key input to hex public key
 * Accepts: npub, nsec (derives pubkey), or hex
 * For nsec: returns { pubkey, secretKey } so caller can clear secretKey
 * For others: returns { pubkey, secretKey: null }
 */
export function normalizeToPublicKey(input: string): {
    pubkey: string;
    secretKey: Uint8Array | null;
} {
    const trimmed = input.trim();

    if (isValidNpub(trimmed)) {
        return { pubkey: npubToPublicKey(trimmed), secretKey: null };
    }

    if (isValidNsec(trimmed)) {
        const sk = nsecToSecretKey(trimmed);
        const pubkey = getPublicKeyFromSecret(sk);
        return { pubkey, secretKey: sk };
    }

    if (isValidHexPubkey(trimmed)) {
        return { pubkey: trimmed.toLowerCase(), secretKey: null };
    }

    throw new Error('Invalid key format. Use npub, nsec, or hex public key.');
}
