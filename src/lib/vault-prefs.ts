import type { VaultKindMode } from '@/lib/vault-utils';

/**
 * Vault display settings, kept in a cookie so they survive reloads and reconnects and the
 * server renders the same values the client will use.
 */
export interface VaultPrefs {
  /** Which contracts of each wrapper / underlying pair the vault list shows. */
  kindMode: VaultKindMode;
  /** Mix a wrapper and its underlying vault into one chart and earned interest. */
  sharedData: boolean;
}

export const VAULT_PREFS_COOKIE = 'muscadine-vault-prefs';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export const DEFAULT_VAULT_PREFS: VaultPrefs = { kindMode: 'recommended', sharedData: true };

const KIND_MODES: readonly VaultKindMode[] = ['recommended', 'wrappers', 'all'];

/** Parse the cookie value; anything missing or unknown falls back to the default. */
export function parseVaultPrefs(raw: string | undefined | null): VaultPrefs {
  if (!raw) return DEFAULT_VAULT_PREFS;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<VaultPrefs>;
    return {
      kindMode: KIND_MODES.includes(parsed.kindMode as VaultKindMode)
        ? (parsed.kindMode as VaultKindMode)
        : DEFAULT_VAULT_PREFS.kindMode,
      sharedData:
        typeof parsed.sharedData === 'boolean' ? parsed.sharedData : DEFAULT_VAULT_PREFS.sharedData,
    };
  } catch {
    return DEFAULT_VAULT_PREFS;
  }
}

/** Read the prefs cookie out of a Cookie header (server) or `document.cookie` (client). */
export function readVaultPrefsFromCookieHeader(cookieHeader: string | null | undefined): VaultPrefs {
  if (!cookieHeader) return DEFAULT_VAULT_PREFS;
  const match = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${VAULT_PREFS_COOKIE}=`));
  return parseVaultPrefs(match?.slice(VAULT_PREFS_COOKIE.length + 1));
}

export function writeVaultPrefsCookie(prefs: VaultPrefs): void {
  try {
    const value = encodeURIComponent(JSON.stringify(prefs));
    document.cookie = `${VAULT_PREFS_COOKIE}=${value}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
  } catch {
    // Cookies blocked: the choice lasts for this page load.
  }
}
