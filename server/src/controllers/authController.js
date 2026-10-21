import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../config/database.js';
import { supabase, supabaseAuth } from '../config/supabase.js';
import { JWT_SECRET, invalidateSessionCache, invalidateUserSessions } from '../middleware/auth.js';
import { logSecurityEvent } from '../utils/auditLogger.js';
import { 
  claimUserSession, 
  releaseUserSession, 
  extractSessionIdFromToken, 
  invalidateSessionLockCache 
} from '../services/sessionLockService.js';

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
};

/**
 * SQLite authentication implementation (existing baseline & rollback path)
 */
async function loginSqlite(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required.'
      });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email.trim());

    if (!user) {
      logSecurityEvent({
        eventType: 'LOGIN_FAILED',
        resourceType: 'user',
        req,
        status: 'DENIED',
        details: 'User not found'
      });
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.'
      });
    }

    if (user.status === 'DISABLED') {
      logSecurityEvent({
        userId: user.id,
        eventType: 'LOGIN_FAILED',
        resourceType: 'user',
        resourceId: user.id,
        req,
        status: 'DENIED',
        details: 'Account disabled'
      });
      return res.status(403).json({
        success: false,
        error: 'Your account has been disabled. Please contact the administrator.'
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      logSecurityEvent({
        userId: user.id,
        eventType: 'LOGIN_FAILED',
        resourceType: 'user',
        resourceId: user.id,
        req,
        status: 'DENIED',
        details: 'Password mismatch'
      });
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.'
      });
    }

    // Generate unique session identifier for this device login
    const sessionId = crypto.randomUUID();
    const token = jwt.sign(
      { id: user.id, role: user.role, sessionId },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    const ua = req.headers['user-agent'] || null;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Atomically claim single active session slot
    const sessionClaim = await claimUserSession({
      userId: user.id,
      sessionId,
      expiresAt,
      ip,
      ua
    });

    if (!sessionClaim.success) {
      if (sessionClaim.code === 'SESSION_ALREADY_ACTIVE') {
        logSecurityEvent({
          userId: user.id,
          eventType: 'LOGIN_CONFLICT',
          resourceType: 'user',
          resourceId: user.id,
          req,
          status: 'DENIED',
          details: 'Account already active on another device'
        });

        return res.status(409).json({
          success: false,
          code: 'SESSION_ALREADY_ACTIVE',
          message: 'This account is already logged in on another device. Please log out from that device before trying again.',
          error: 'This account is already logged in on another device. Please log out from that device before trying again.'
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Authentication failed due to session verification error.'
      });
    }

    res.cookie('pasconix_token', token, COOKIE_OPTIONS);

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status
    };

    logSecurityEvent({
      userId: user.id,
      eventType: 'LOGIN_SUCCESS',
      resourceType: 'user',
      resourceId: user.id,
      req,
      status: 'SUCCESS'
    });

    return res.json({
      success: true,
      message: 'Login successful.',
      user: safeUser,
      token
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Supabase Auth implementation with public.profiles validation
 */
async function loginSupabase(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required.'
      });
    }

    if (!supabase) {
      return res.status(500).json({
        success: false,
        error: 'Supabase authentication service is not configured.'
      });
    }

    const authClient = supabaseAuth || supabase;
    const { data, error } = await authClient.auth.signInWithPassword({
      email: email.trim(),
      password
    });

    if (error) {
      const errMsg = error.message || '';
      const isBanned = errMsg.toLowerCase().includes('banned') || errMsg.toLowerCase().includes('disabled');

      if (isBanned) {
        // Attempt to find profile UUID for security audit trail
        const { data: bannedProfile } = await supabase
          .from('profiles')
          .select('id')
          .ilike('email', email.trim())
          .maybeSingle();

        logSecurityEvent({
          userId: bannedProfile?.id || null,
          eventType: 'LOGIN_FAILED',
          resourceType: 'user',
          resourceId: bannedProfile?.id || null,
          req,
          status: 'DENIED',
          details: 'Account disabled'
        });

        return res.status(403).json({
          success: false,
          error: 'Your account has been disabled. Please contact the administrator.'
        });
      }

      logSecurityEvent({
        eventType: 'LOGIN_FAILED',
        resourceType: 'user',
        req,
        status: 'DENIED',
        details: errMsg === 'Invalid login credentials' ? 'Invalid email or password' : errMsg
      });

      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.'
      });
    }

    // Validate authenticated user against public.profiles
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, name, email, role, status')
      .eq('id', data.user.id)
      .single();

    if (profileError || !profile) {
      logSecurityEvent({
        userId: data.user.id,
        eventType: 'LOGIN_FAILED',
        resourceType: 'user',
        resourceId: data.user.id,
        req,
        status: 'DENIED',
        details: 'User profile not found'
      });
      return res.status(401).json({
        success: false,
        error: 'User profile not found.'
      });
    }

    if (profile.status === 'DISABLED') {
      logSecurityEvent({
        userId: profile.id,
        eventType: 'LOGIN_FAILED',
        resourceType: 'user',
        resourceId: profile.id,
        req,
        status: 'DENIED',
        details: 'Account disabled'
      });
      return res.status(403).json({
        success: false,
        error: 'Your account has been disabled. Please contact the administrator.'
      });
    }

    const token = data.session?.access_token;
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Login failed: unable to establish session. Please verify your email or contact support.'
      });
    }

    const decoded = jwt.decode(token);
    const sessionId = decoded?.session_id || token;
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    const ua = req.headers['user-agent'] || null;
    const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Atomically claim single active session slot
    const sessionClaim = await claimUserSession({
      userId: profile.id,
      sessionId,
      expiresAt,
      ip,
      ua
    });

    if (!sessionClaim.success) {
      if (sessionClaim.code === 'SESSION_ALREADY_ACTIVE') {
        // Safely revoke the newly created losing session without invalidating Device A's winning session
        try {
          if (supabase && typeof supabase.auth?.admin?.signOut === 'function') {
            await supabase.auth.admin.signOut(token, 'local');
          }
        } catch (cleanupErr) {
          console.warn('Losing session cleanup notice:', cleanupErr.message);
        }

        logSecurityEvent({
          userId: profile.id,
          eventType: 'LOGIN_CONFLICT',
          resourceType: 'user',
          resourceId: profile.id,
          req,
          status: 'DENIED',
          details: 'Account already active on another device'
        });

        return res.status(409).json({
          success: false,
          code: 'SESSION_ALREADY_ACTIVE',
          message: 'This account is already logged in on another device. Please log out from that device before trying again.',
          error: 'This account is already logged in on another device. Please log out from that device before trying again.'
        });
      }

      // Fail closed on database/verification error
      return res.status(500).json({
        success: false,
        error: 'Authentication failed due to session verification error.'
      });
    }

    res.cookie('pasconix_token', token, COOKIE_OPTIONS);

    const safeUser = {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      role: profile.role,
      status: profile.status
    };

    logSecurityEvent({
      userId: profile.id,
      eventType: 'LOGIN_SUCCESS',
      resourceType: 'user',
      resourceId: profile.id,
      req,
      status: 'SUCCESS'
    });

    return res.json({
      success: true,
      message: 'Login successful.',
      user: safeUser,
      token
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Main login handler dispatching based on active DATA_BACKEND
 */
export async function login(req, res, next) {
  if (process.env.DATA_BACKEND === 'supabase' || (process.env.VERCEL && process.env.DATA_BACKEND !== 'sqlite')) {
    return loginSupabase(req, res, next);
  }
  return loginSqlite(req, res, next);
}

export async function logout(req, res) {
  const token = req.cookies?.pasconix_token || req.headers?.authorization?.replace(/^Bearer\s+/i, '');
  const sessionId = extractSessionIdFromToken(token);

  let userId = req.user?.id;
  if (!userId && token) {
    try {
      const decoded = jwt.decode(token);
      userId = decoded?.sub || decoded?.id;
    } catch {}
  }

  if (token) {
    invalidateSessionCache(token);
  }

  if (userId) {
    invalidateUserSessions(userId);
    invalidateSessionLockCache(userId);

    // Safely release the session lock only if the sessionId matches
    if (sessionId) {
      await releaseUserSession({ userId, sessionId });
    }

    // Revoke Supabase session if in supabase mode
    if (process.env.DATA_BACKEND === 'supabase' && token && supabase) {
      try {
        if (typeof supabase.auth?.admin?.signOut === 'function') {
          await supabase.auth.admin.signOut(token, 'local');
        }
      } catch (err) {
        // Non-blocking cleanup
      }
    }

    logSecurityEvent({
      userId,
      eventType: 'LOGOUT',
      resourceType: 'user',
      resourceId: userId,
      req,
      status: 'SUCCESS'
    });
  }

  res.clearCookie('pasconix_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });

  return res.json({
    success: true,
    message: 'Successfully logged out.'
  });
}

export function getCurrentUser(req, res) {
  return res.json({
    success: true,
    user: req.user
  });
}

/**
 * SQLite implementation for self-service password change
 */
async function changePasswordSqlite(req, res, next, user, currentPassword, newPassword) {
  try {
    const dbUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    if (!dbUser) {
      return res.status(404).json({
        success: false,
        error: 'User account not found.'
      });
    }

    // 1. Verify current password
    const isMatch = await bcrypt.compare(currentPassword, dbUser.password_hash);
    if (!isMatch) {
      logSecurityEvent({
        userId: user.id,
        eventType: 'USER_PASSWORD_CHANGE_FAILED',
        resourceType: 'user',
        resourceId: user.id,
        req,
        status: 'DENIED',
        details: 'Current password verification failed'
      });
      return res.status(400).json({
        success: false,
        error: 'Current password is incorrect.'
      });
    }

    // 2. Hash new password and update in database
    const passwordHash = await bcrypt.hash(newPassword, 10);
    db.prepare(`
      UPDATE users 
      SET password_hash = ?, updated_at = datetime('now') 
      WHERE id = ?
    `).run(passwordHash, user.id);

    // 3. Invalidate session cache
    invalidateUserSessions(user.id);
    invalidateSessionLockCache(user.id);
    const oldToken = req.cookies?.pasconix_token || req.headers?.authorization?.replace(/^Bearer\s+/i, '');
    if (oldToken) {
      invalidateSessionCache(oldToken);
    }

    // 4. Issue fresh JWT and set cookie
    const sessionId = crypto.randomUUID();
    const token = jwt.sign(
      { id: user.id, role: user.role, sessionId },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    await claimUserSession({
      userId: user.id,
      sessionId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ip: req.ip || req.headers['x-forwarded-for'] || null,
      ua: req.headers['user-agent'] || null
    });
    res.cookie('pasconix_token', token, COOKIE_OPTIONS);

    // 5. Record security audit log
    logSecurityEvent({
      userId: user.id,
      eventType: 'USER_CHANGED_OWN_PASSWORD',
      resourceType: 'user',
      resourceId: user.id,
      req,
      status: 'SUCCESS',
      details: {
        role: user.role,
        action: 'SELF_SERVICE_PASSWORD_CHANGE'
      }
    });

    return res.json({
      success: true,
      message: 'Password changed successfully.',
      token
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Supabase Auth implementation for self-service password change
 */
async function changePasswordSupabase(req, res, next, user, currentPassword, newPassword) {
  try {
    if (!supabase) {
      return res.status(500).json({
        success: false,
        error: 'Supabase authentication service is not configured.'
      });
    }

    const authClient = supabaseAuth || supabase;

    // 1. Verify current password against Supabase Auth
    const { error: verifyError } = await authClient.auth.signInWithPassword({
      email: user.email.trim(),
      password: currentPassword
    });

    if (verifyError) {
      logSecurityEvent({
        userId: user.id,
        eventType: 'USER_PASSWORD_CHANGE_FAILED',
        resourceType: 'user',
        resourceId: user.id,
        req,
        status: 'DENIED',
        details: 'Current password verification failed'
      });
      return res.status(400).json({
        success: false,
        error: 'Current password is incorrect.'
      });
    }

    // 2. Update password in Supabase Auth using service role admin client
    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      password: newPassword
    });

    if (updateError) {
      logSecurityEvent({
        userId: user.id,
        eventType: 'USER_PASSWORD_CHANGE_FAILED',
        resourceType: 'user',
        resourceId: user.id,
        req,
        status: 'ERROR',
        details: updateError.message
      });
      return res.status(400).json({
        success: false,
        error: updateError.message || 'Failed to update password in authentication service.'
      });
    }

    // 3. Invalidate session cache for the user
    invalidateUserSessions(user.id);
    invalidateSessionLockCache(user.id);
    const oldToken = req.cookies?.pasconix_token || req.headers?.authorization?.replace(/^Bearer\s+/i, '');
    if (oldToken) {
      invalidateSessionCache(oldToken);
    }

    // 4. Establish a fresh secure session with the new password
    const { data: newSessionData } = await authClient.auth.signInWithPassword({
      email: user.email.trim(),
      password: newPassword
    });

    let token = null;
    if (newSessionData?.session?.access_token) {
      token = newSessionData.session.access_token;
      const decoded = jwt.decode(token);
      const sessionId = decoded?.session_id || token;
      await claimUserSession({
        userId: user.id,
        sessionId,
        expiresAt: decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ip: req.ip || req.headers['x-forwarded-for'] || null,
        ua: req.headers['user-agent'] || null
      });
      res.cookie('pasconix_token', token, COOKIE_OPTIONS);
    }

    // 5. Record security audit log
    logSecurityEvent({
      userId: user.id,
      eventType: 'USER_CHANGED_OWN_PASSWORD',
      resourceType: 'user',
      resourceId: user.id,
      req,
      status: 'SUCCESS',
      details: {
        role: user.role,
        action: 'SELF_SERVICE_PASSWORD_CHANGE'
      }
    });

    return res.json({
      success: true,
      message: 'Password changed successfully.',
      token
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Self-service change password controller.
 * The authenticated user (req.user) is the SOLE authority.
 * Does NOT accept or respect userId/studentId/adminId from client.
 */
export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    // Validate required fields
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        error: 'Current password, new password, and confirmation are required.'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        error: 'New password and confirmation do not match.'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 6 characters long.'
      });
    }

    if (newPassword === currentPassword) {
      return res.status(400).json({
        success: false,
        error: 'New password must be different from current password.'
      });
    }

    // Authenticated user identity from session is the only authority
    const user = req.user;
    if (!user || !user.id || !user.email) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.'
      });
    }

    if (user.status === 'DISABLED') {
      logSecurityEvent({
        userId: user.id,
        eventType: 'USER_PASSWORD_CHANGE_FAILED',
        resourceType: 'user',
        resourceId: user.id,
        req,
        status: 'DENIED',
        details: 'Account is disabled'
      });
      return res.status(403).json({
        success: false,
        error: 'Your account has been disabled. Please contact the administrator.'
      });
    }

    if (process.env.DATA_BACKEND === 'supabase') {
      return await changePasswordSupabase(req, res, next, user, currentPassword, newPassword);
    }
    return await changePasswordSqlite(req, res, next, user, currentPassword, newPassword);
  } catch (error) {
    next(error);
  }
}

