/**
 * NIP-44 decryption utilities
 * Used for decrypting nostrsave encrypted chunks
 */

import * as nip44 from 'nostr-tools/nip44';

/**
 * Decrypt a NIP-44 encrypted chunk
 * Uses self-encryption: sender and recipient are the same key
 * 
 * @param ciphertext - Base64 encoded NIP-44 encrypted payload
 * @param secretKey - Secret key as Uint8Array
 * @param pubkey - Public key (hex) - same as derived from secretKey for self-encryption
 * @returns Decrypted data as Uint8Array
 */
export function decryptChunk(
    ciphertext: string,
    secretKey: Uint8Array,
    pubkey: string
): Uint8Array {
    // NIP-44 decrypt returns a string, but chunk data may be binary
    // The content is base64 encoded encrypted data
    const conversationKey = nip44.v2.utils.getConversationKey(secretKey, pubkey);
    const decrypted = nip44.v2.decrypt(ciphertext, conversationKey);

    // Convert decrypted string to Uint8Array (it's binary data encoded as string)
    // The original chunk data was binary, so we need to handle it properly
    return new TextEncoder().encode(decrypted);
}

/**
 * Decrypt a NIP-44 encrypted chunk and return as binary
 * For file chunks, the content is actually base64-encoded binary after decryption
 * 
 * @param ciphertext - NIP-44 encrypted payload
 * @param secretKey - Secret key as Uint8Array
 * @param pubkey - Public key (hex)
 * @returns Decrypted binary data
 */
export function decryptChunkBinary(
    ciphertext: string,
    secretKey: Uint8Array,
    pubkey: string
): Uint8Array {
    const conversationKey = nip44.v2.utils.getConversationKey(secretKey, pubkey);
    const decrypted = nip44.v2.decrypt(ciphertext, conversationKey);

    // The decrypted content is base64-encoded binary data
    // Decode base64 to get the actual binary chunk
    return base64ToUint8Array(decrypted);
}

/**
 * Convert base64 string to Uint8Array
 */
export function base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

/**
 * Convert Uint8Array to base64 string
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
    let binaryString = '';
    for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i]);
    }
    return btoa(binaryString);
}
