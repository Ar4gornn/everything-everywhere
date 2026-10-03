import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  ApiError,
  api,
  clearTokens,
  readRefreshToken,
  readToken,
  setUnauthorizedHandler,
  storeTokens,
} from "../api/client";
import type { Currency, Language, PreferencesPatch, User } from "../api/types";
import { PreferenceSaver, preferencesOf, type Versioned } from "../layout/preferences";
import { clearEntriesStore } from "../entries/outbox";
import { clearGymStore } from "../gym/store";
import { clearPlace } from "../moon/location";
import { clearAllDrafts } from "../notes/drafts";
import { deviceZone } from "../push";
import { PREFIX } from "../storage";

/**
 * The last user the server sent, kept so the installed app can open with no network (Epic 42,
 * AD-58). Without it an offline launch has a token and no idea whose it is. It holds what the
 * profile already holds (email, preferences, units) and goes wherever the tokens go: removed
 * on sign-out and when the server says the session is over.
 */
const SNAPSHOT_KEY = `${PREFIX}user.snapshot`;

function readSnapshot(): User | null {
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" && typeof (parsed as User).id === "string"
      ? (parsed as User)
      : null;
  } catch {
    return null;
  }
}

function writeSnapshot(user: User | null): void {
  try {
    if (user === null) window.localStorage.removeItem(SNAPSHOT_KEY);
    else window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(user));
  } catch {
    /* Full or blocked: the next offline launch signs in again, as it always did. */
  }
}

/** A tab back in view re-reads the account if it has not heard from the server this long. */
export const REREAD_MS = 30_000;

/** A user's preferences with the version a write over them must name. */
function versioned(user: User): Versioned {
  return { prefs: preferencesOf(user), version: user.preferences_version ?? null };
}

interface AuthState {
  user: User | null;
  loading: boolean;
  /**
   * True while the profile on screen is the stored snapshot because the server could not be
   * reached at launch (Epic 42). Cleared as soon as the server answers.
   */
  offline: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    inviteCode?: string,
    currency?: Currency,
    language?: Language,
  ) => Promise<void>;
  signOut: () => void;
  /** Re-read the profile after something server-side changes it. */
  refreshUser: () => Promise<User>;
  /**
   * Epic 33: change the account's layout preferences. Shown at once, saved one request at
   * a time, reverted if the save fails — and the promise rejects, so the control can say so.
   */
  updatePreferences: (patch: PreferencesPatch) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  // Who is signed in, for the places that must not wait for a render to know (sign-out).
  const userId = useRef<string | null>(null);
  // One saver per account. A save still in flight when its owner signs out, or another
  // account signs in, lands on nobody: `onChange` only touches the user it was made for.
  const saver = useRef<{ owner: string; saver: PreferenceSaver } | null>(null);

  // Epic 36 (AD-52): an account with no zone is given this browser's, once per session, so
  // "today" and the digest's hour mean the person's day rather than the server's. `null`
  // only — `undefined` is a server that predates the column, and a zone already chosen is
  // never overwritten from a device that happens to be travelling.
  const zoneFilled = useRef<Set<string>>(new Set());

  // When the server last told this tab who it is, so a tab coming back into view knows
  // whether its copy may be stale (see the visibility effect below).
  const lastHeard = useRef(0);

  /**
   * Every user that comes from the server goes through here, so the saver hears it too.
   * `stamp` is the saver's, taken when the read started: a read older than a preferences
   * write is not allowed to show that write undone.
   */
  const adopt = useCallback((found: User, fromSnapshot = false, stamp?: number) => {
    setOffline(fromSnapshot);
    userId.current = found.id;
    // The snapshot is only ever what the server last said, never itself.
    if (!fromSnapshot) {
      writeSnapshot(found);
      lastHeard.current = Date.now();
    }
    const zone = deviceZone();
    if (!fromSnapshot && found.timezone === null && zone && !zoneFilled.current.has(found.id)) {
      zoneFilled.current.add(found.id);
      const owner = found.id;
      void api
        .setNotificationSchedule({ timezone: zone, digest_time: found.digest_time ?? "19:00" })
        .then(
          (updated) =>
            setUser((current) =>
              current && current.id === owner
                ? { ...current, timezone: updated.timezone, digest_time: updated.digest_time }
                : current,
            ),
          () => undefined,
        );
    }
    const { prefs, version } = versioned(found);
    if (saver.current?.owner === found.id) {
      saver.current.saver.confirm(prefs, version, stamp);
    } else {
      const owner = found.id;
      saver.current = {
        owner,
        saver: new PreferenceSaver(
          prefs,
          async (patch, current) => versioned(await api.setPreferences(patch, current)),
          (shown) =>
            setUser((user) =>
              user && user.id === owner ? { ...user, preferences: shown } : user,
            ),
          { version, reload: async () => versioned(await api.me()) },
        ),
      };
    }
    // The rest of the profile is the server's; the preferences are what the saver shows,
    // which keeps any change still queued or in flight on screen.
    setUser({ ...found, preferences: saver.current.saver.shown });
  }, []);

  const signOut = useCallback(() => {
    // Tell the server first so the refresh token is revoked rather than merely forgotten,
    // then clear locally regardless of whether that call succeeded.
    const refreshToken = readRefreshToken();
    if (refreshToken) void api.logout(refreshToken).catch(() => undefined);
    clearTokens();
    writeSnapshot(null);
    // The gym (Epic 42): cache, session in progress and unsent sessions go with the tokens,
    // for the reason notes do. Only an explicit sign-out — an expired session keeps them,
    // so signing back in sends them. The controls ask first when something would be lost
    // (`useSignOut`).
    if (userId.current) clearGymStore(userId.current);
    // Epic 45: sheet entries not yet sent and the sheet's cached chips go the same way.
    if (userId.current) clearEntriesStore(userId.current);
    // Epic 47 (AD-63): the place chosen for moonrise stays on this device only while its
    // owner is signed in. Expiry keeps it, like the gym store.
    if (userId.current) clearPlace(userId.current);
    userId.current = null;
    // Notes not yet synced are removed with the session (Epic 32): a note left in a browser
    // after its owner signed out is the leak signing out is for. See `notes/drafts.ts`.
    clearAllDrafts();
    saver.current = null;
    setUser(null);
    setOffline(false);
  }, []);

  // AD-16: the 401 path is registered once. Expiry is the only way a session ends in v1,
  // since there is no refresh flow (AD-13).
  useEffect(() => {
    setUnauthorizedHandler(() => {
      saver.current = null;
      writeSnapshot(null);
      userId.current = null;
      setUser(null);
      setOffline(false);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!readToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((found) => {
        if (!cancelled) adopt(found);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        // Only the server saying the session is over signs the person out. No network, a
        // 5xx, a proxy restarting: the tokens are as good as they were, and the app opens
        // on the last profile it saw (Epic 42). With no snapshot there is nobody to open it
        // as, so it behaves as it always did.
        const ended = caught instanceof ApiError && caught.status === 401;
        const snapshot = ended ? null : readSnapshot();
        if (snapshot && readToken()) adopt(snapshot, true);
        else {
          clearTokens();
          writeSnapshot(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [adopt]);

  // Back online after an offline launch: ask the server who we are, once, quietly. A failure
  // leaves the snapshot on screen and the next `online` tries again.
  useEffect(() => {
    if (!offline) return;
    const retry = () => void api.me().then((found) => adopt(found), () => undefined);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [offline, adopt]);

  const signIn = useCallback(async (email: string, password: string) => {
    storeTokens(await api.login(email, password));
    adopt(await api.me());
  }, [adopt]);

  const register = useCallback(
    async (
      email: string,
      password: string,
      inviteCode?: string,
      currency?: Currency,
      language?: Language,
    ) => {
      await api.register(email, password, inviteCode, currency, language);
      await signIn(email, password);
    },
    [signIn],
  );

  const refreshUser = useCallback(async () => {
    const stamp = saver.current?.saver.stamp();
    const found = await api.me();
    adopt(found, false, stamp);
    return found;
  }, [adopt]);

  // A tab left open for days holds the account as it was, and its next preferences write
  // would carry that old copy (the server's version check refuses it, but only at write
  // time). So when the tab comes back into view or focus, it re-reads who it is — at most
  // once per REREAD_MS, and through `refreshUser`, so a change still queued or in flight
  // stays on screen and a read that started before it cannot show it undone.
  const signedIn = user !== null;
  useEffect(() => {
    if (!signedIn) return;
    const reread = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastHeard.current < REREAD_MS) return;
      lastHeard.current = Date.now();
      void refreshUser().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", reread);
    window.addEventListener("focus", reread);
    return () => {
      document.removeEventListener("visibilitychange", reread);
      window.removeEventListener("focus", reread);
    };
  }, [signedIn, refreshUser]);

  const updatePreferences = useCallback((patch: PreferencesPatch) => {
    if (saver.current === null) return Promise.reject(new Error("signed out"));
    return saver.current.saver.update(patch);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      offline,
      signIn,
      register,
      signOut,
      refreshUser,
      updatePreferences,
    }),
    [user, loading, offline, signIn, register, signOut, refreshUser, updatePreferences],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (context === null) throw new Error("useAuth must be used inside an AuthProvider");
  return context;
}

/**
 * The context without the throw, for consumers that have a sensible default.
 *
 * Money formatting is the case: a currency symbol has an obvious fallback, and a formatter
 * that crashes an entire subtree because it rendered outside the provider is worse than one
 * that shows dollars. Anything that genuinely needs a signed-in user still uses `useAuth`.
 */
export function useOptionalAuth(): AuthState | null {
  return useContext(AuthContext);
}
