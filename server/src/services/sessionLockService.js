import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase.js';
import { claimSessionSqlite, releaseSessionSqlite, verifySessionSqlite } from '../config/database.js';

/**
 * In-memory cache for fast session-lock verification (15 seconds TTL).
 * Reduces round-trip latency to remote database while maintaining high security.
 */
const lockVerificationCache = new Map();
const LOCK_CACHE_TTL_MS = 15 * 1000;

function getCacheKey(userId, sessionId) {
  return `${userId}:${sessionId}`;
}

export function invalidateSessionLockCache(userId) {
  if (!userId) return;
  const prefix = `${userId}:`;
  for (const key of lockVerificationCache.keys()) {
    if (key.startsWith(prefix)) {
      lockVerificationCache.delete(key);
    }
  }
}

function isSupabaseBackend() {
  return process.env.DATA_BACKEND === 'supabase' || (process.env.VERCEL && process.env.DATA_BACKEND !== 'sqlite');
}

/**
 * Extracts session ID from a Supabase Auth access token or local JWT token.
 */
export function extractSessionIdFromToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const decoded = jwt.decode(token.trim());
    if (!decoded) return null;
    return decoded.session_id || decoded.sessionId || decoded.jti || null;
  } catch {
    return null;
  }
}

/**
 * Atomically claims the single active session slot for a user.
 * Returns: { success: true } on success.
 * Returns: { success: false, code: 'SESSION_ALREADY_ACTIVE' } if another active session exists.
 * Returns: { success: false, code: 'DB_ERROR', error: string } on failure.
 */
export async function claimUserSession({ userId, sessionId, expiresAt, ip = null, ua = null }) {
  if (!userId || !sessionId) {
    return { success: false, code: 'INVALID_PARAMETERS', error: 'User ID and Session ID are required' };
  }

  // Clear any existing cache entry for this user to ensure fresh state
  invalidateSessionLockCache(userId);

  const expiresAtDate = expiresAt instanceof Date ? expiresAt : new Date(expiresAt || (Date.now() + 7 * 24 * 60 * 60 * 1000));
  const expiresAtIso = expiresAtDate.toISOString();

  if (isSupabaseBackend()) {
    if (!supabase) {
      return { success: false, code: 'DB_ERROR', error: 'Supabase client is not configured' };
    }

    try {
      // 1. Try atomic database function (SECURITY DEFINER)
      const { data, error } = await supabase.rpc('claim_user_session', {
        p_user_id: userId,
        p_session_id: sessionId,
        p_expires_at: expiresAtIso,
        p_ip: ip || null,
        p_ua: ua || null
      });

      if (!error && typeof data === 'boolean') {
        if (data === true) {
          lockVerificationCache.set(getCacheKey(userId, sessionId), {
            valid: true,
            expiresAt: Date.now() + LOCK_CACHE_TTL_MS
          });
          return { success: true };
        }
        return { success: false, code: 'SESSION_ALREADY_ACTIVE' };
      }

      // 2. Direct table fallback if RPC is not yet created
      const { data: existing, error: selectErr } = await supabase
        .from('active_login_sessions')
        .select('session_id, expires_at')
        .eq('user_id', userId)
        .maybeSingle();

      if (selectErr) {
        console.warn('active_login_sessions lookup warning:', selectErr.message);
        // Fail closed on database error
        return { success: false, code: 'DB_ERROR', error: selectErr.message };
      }

      const now = new Date();

      if (!existing) {
        // Attempt insert
        const { error: insertErr } = await supabase
          .from('active_login_sessions')
          .insert({
            user_id: userId,
            session_id: sessionId,
            expires_at: expiresAtIso,
            ip_address: ip,
            user_agent: ua
          });

        if (insertErr) {
          // If insert conflict or another device claimed concurrently
          return { success: false, code: 'SESSION_ALREADY_ACTIVE' };
        }
        lockVerificationCache.set(getCacheKey(userId, sessionId), {
          valid: true,
          expiresAt: Date.now() + LOCK_CACHE_TTL_MS
        });
        return { success: true };
      }

      // Check if existing session has expired
      if (new Date(existing.expires_at) < now) {
        const { error: updateErr } = await supabase
          .from('active_login_sessions')
          .update({
            session_id: sessionId,
            expires_at: expiresAtIso,
            ip_address: ip,
            user_agent: ua,
            updated_at: now.toISOString()
          })
          .eq('user_id', userId);

        if (updateErr) {
          return { success: false, code: 'DB_ERROR', error: updateErr.message };
        }
        lockVerificationCache.set(getCacheKey(userId, sessionId), {
          valid: true,
          expiresAt: Date.now() + LOCK_CACHE_TTL_MS
        });
        return { success: true };
      }

      // Check if existing session is the SAME session renewing
      if (existing.session_id === sessionId) {
        await supabase
          .from('active_login_sessions')
          .update({
            expires_at: expiresAtIso,
            ip_address: ip || undefined,
            user_agent: ua || undefined,
            updated_at: now.toISOString()
          })
          .eq('user_id', userId);

        lockVerificationCache.set(getCacheKey(userId, sessionId), {
          valid: true,
          expiresAt: Date.now() + LOCK_CACHE_TTL_MS
        });
        return { success: true };
      }

      // Otherwise, an active session exists on another device!
      return { success: false, code: 'SESSION_ALREADY_ACTIVE' };
    } catch (err) {
      console.error('Session claim error:', err);
      return { success: false, code: 'DB_ERROR', error: err.message };
    }
  }

  // SQLite implementation
  const acquired = claimSessionSqlite(userId, sessionId, expiresAtDate, ip, ua);
  if (acquired) {
    lockVerificationCache.set(getCacheKey(userId, sessionId), {
      valid: true,
      expiresAt: Date.now() + LOCK_CACHE_TTL_MS
    });
    return { success: true };
  }
  return { success: false, code: 'SESSION_ALREADY_ACTIVE' };
}

/**
 * Safely releases an active session lock upon user logout.
 * Requires matching both userId AND sessionId so a stale logout from an older
 * session cannot release a newer active session lock held by another device.
 */
export async function releaseUserSession({ userId, sessionId }) {
  if (!userId || !sessionId) return false;

  invalidateSessionLockCache(userId);

  if (isSupabaseBackend()) {
    if (!supabase) return false;
    try {
      const { data, error } = await supabase.rpc('release_user_session', {
        p_user_id: userId,
        p_session_id: sessionId
      });

      if (!error && typeof data === 'boolean') {
        return data;
      }

      // Fallback direct delete
      const { error: delErr } = await supabase
        .from('active_login_sessions')
        .delete()
        .eq('user_id', userId)
        .eq('session_id', sessionId);

      return !delErr;
    } catch (err) {
      console.warn('Supabase session release error:', err.message);
      return false;
    }
  }

  return releaseSessionSqlite(userId, sessionId);
}

/**
 * Verifies if the specified session ID is the active lock holder and has not expired.
 */
export async function verifyUserSession({ userId, sessionId }) {
  if (!userId || !sessionId) return false;

  // 1. Check local verification cache
  const cacheKey = getCacheKey(userId, sessionId);
  const cached = lockVerificationCache.get(cacheKey);
  const now = Date.now();
  if (cached && now < cached.expiresAt) {
    return cached.valid;
  }

  if (isSupabaseBackend()) {
    if (!supabase) return false;
    try {
      // Try RPC
      const { data, error } = await supabase.rpc('verify_user_session', {
        p_user_id: userId,
        p_session_id: sessionId
      });

      if (!error && typeof data === 'boolean') {
        lockVerificationCache.set(cacheKey, {
          valid: data,
          expiresAt: now + LOCK_CACHE_TTL_MS
        });
        return data;
      }

      // Direct fallback
      const { data: record, error: recErr } = await supabase
        .from('active_login_sessions')
        .select('session_id, expires_at')
        .eq('user_id', userId)
        .maybeSingle();

      if (recErr || !record) {
        lockVerificationCache.set(cacheKey, { valid: false, expiresAt: now + 5000 });
        return false;
      }

      const isValid = record.session_id === sessionId && new Date(record.expires_at) > new Date();
      lockVerificationCache.set(cacheKey, {
        valid: isValid,
        expiresAt: now + LOCK_CACHE_TTL_MS
      });
      return isValid;
    } catch (err) {
      console.warn('Session verification error:', err.message);
      return false;
    }
  }

  const isValid = verifySessionSqlite(userId, sessionId);
  lockVerificationCache.set(cacheKey, {
    valid: isValid,
    expiresAt: now + LOCK_CACHE_TTL_MS
  });
  return isValid;
}
