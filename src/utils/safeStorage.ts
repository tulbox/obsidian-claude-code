/**
 * Encrypt/decrypt API keys using Electron's safeStorage API.
 * Falls back to plaintext when safeStorage is unavailable.
 */

import { logger } from "./Logger";

// Prefix to identify encrypted values in settings.
const ENCRYPTED_PREFIX = "enc:";

// Cache the safeStorage module to avoid repeated require() calls.
let _safeStorage: { isEncryptionAvailable(): boolean; encryptString(s: string): Buffer; decryptString(b: Buffer): string } | null = null;
let _safeStorageChecked = false;

function getSafeStorage() {
  if (!_safeStorageChecked) {
    _safeStorageChecked = true;
    try {
      const electron = require("electron");
      _safeStorage = electron.safeStorage;
    } catch {
      _safeStorage = null;
    }
  }
  return _safeStorage;
}

/**
 * Check if Electron safeStorage encryption is available.
 */
export function isEncryptionAvailable(): boolean {
  const ss = getSafeStorage();
  return ss?.isEncryptionAvailable() ?? false;
}

/**
 * Encrypt a string using Electron safeStorage.
 * Returns prefixed base64 if encryption is available, otherwise returns plaintext.
 */
export function encryptString(value: string): string {
  if (!value) return value;

  const ss = getSafeStorage();
  if (ss?.isEncryptionAvailable()) {
    try {
      const encrypted = ss.encryptString(value);
      return ENCRYPTED_PREFIX + encrypted.toString("base64");
    } catch (e) {
      logger.warn("SafeStorage", "Encryption failed, storing plaintext", { error: String(e) });
    }
  }

  return value;
}

/**
 * Decrypt a string using Electron safeStorage.
 * Handles both encrypted (prefixed) and plaintext (legacy) values.
 */
export function decryptString(stored: string): string {
  if (!stored) return stored;

  if (stored.startsWith(ENCRYPTED_PREFIX)) {
    const ss = getSafeStorage();
    if (ss?.isEncryptionAvailable()) {
      try {
        const encrypted = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), "base64");
        return ss.decryptString(encrypted);
      } catch (e) {
        logger.warn("SafeStorage", "Decryption failed", { error: String(e) });
        return "";
      }
    }
    logger.warn("SafeStorage", "Cannot decrypt: safeStorage unavailable. Key will need to be re-entered.");
    return "";
  }

  // Plaintext (legacy or fallback) — return as-is.
  return stored;
}
