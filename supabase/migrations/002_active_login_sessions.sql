-- ==============================================================================
-- PASCONX LMS: Migration 002 - Single Active Session Enforcement
-- ==============================================================================
-- Description: Creates the active_login_sessions table and atomic procedures to enforce
--              one active login session per user account across all devices and roles.
-- Security:    RLS enabled with no public/anon access. Access restricted to service_role.
-- ==============================================================================

-- 1. Create active_login_sessions table
CREATE TABLE IF NOT EXISTS public.active_login_sessions (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. Indexes for fast session lookup and cleanup
CREATE INDEX IF NOT EXISTS idx_active_login_sessions_session_id 
  ON public.active_login_sessions(session_id);

CREATE INDEX IF NOT EXISTS idx_active_login_sessions_expires_at 
  ON public.active_login_sessions(expires_at);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.active_login_sessions ENABLE ROW LEVEL SECURITY;

-- Deny all direct access to anon and authenticated users.
-- Only the backend service_role key and SECURITY DEFINER functions may access this table.
REVOKE ALL ON TABLE public.active_login_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.active_login_sessions TO service_role;

-- 4. Atomic Session Claim Function
-- Atomically acquires a session slot:
--   - Returns true if the session slot was successfully acquired or renewed.
--   - Returns false if another active (unexpired) session already holds the slot.
CREATE OR REPLACE FUNCTION public.claim_user_session(
  p_user_id UUID,
  p_session_id TEXT,
  p_expires_at TIMESTAMPTZ,
  p_ip TEXT DEFAULT NULL,
  p_ua TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_session TEXT;
  v_current_expires TIMESTAMPTZ;
BEGIN
  -- Validate inputs
  IF p_user_id IS NULL OR p_session_id IS NULL OR p_expires_at IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Acquire row-level lock on existing session record if one exists
  SELECT session_id, expires_at 
    INTO v_current_session, v_current_expires
    FROM public.active_login_sessions
   WHERE user_id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    -- No active session exists: claim the slot
    INSERT INTO public.active_login_sessions (
      user_id,
      session_id,
      expires_at,
      ip_address,
      user_agent,
      created_at,
      updated_at
    ) VALUES (
      p_user_id,
      p_session_id,
      p_expires_at,
      p_ip,
      p_ua,
      timezone('utc'::text, now()),
      timezone('utc'::text, now())
    );
    RETURN TRUE;
  END IF;

  -- If previous session has expired: replace it with the new session
  IF v_current_expires < timezone('utc'::text, now()) THEN
    UPDATE public.active_login_sessions
       SET session_id = p_session_id,
           expires_at = p_expires_at,
           ip_address = p_ip,
           user_agent = p_ua,
           created_at = timezone('utc'::text, now()),
           updated_at = timezone('utc'::text, now())
     WHERE user_id = p_user_id;
    RETURN TRUE;
  END IF;

  -- If it is the SAME session renewing or re-authenticating: update expiry
  IF v_current_session = p_session_id THEN
    UPDATE public.active_login_sessions
       SET expires_at = p_expires_at,
           ip_address = COALESCE(p_ip, ip_address),
           user_agent = COALESCE(p_ua, user_agent),
           updated_at = timezone('utc'::text, now())
     WHERE user_id = p_user_id;
    RETURN TRUE;
  END IF;

  -- Otherwise, an unexpired session belongs to another device/browser: CONFLICT!
  RETURN FALSE;
END;
$$;

-- 5. Session Release Function (Logout)
-- Safely releases the lock ONLY if the requesting session matches the active session.
CREATE OR REPLACE FUNCTION public.release_user_session(
  p_user_id UUID,
  p_session_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted BOOLEAN;
BEGIN
  IF p_user_id IS NULL OR p_session_id IS NULL THEN
    RETURN FALSE;
  END IF;

  DELETE FROM public.active_login_sessions
   WHERE user_id = p_user_id
     AND session_id = p_session_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- 6. Session Verification Function
-- Verifies that a given session is currently active and unexpired.
CREATE OR REPLACE FUNCTION public.verify_user_session(
  p_user_id UUID,
  p_session_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS NULL OR p_session_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 
      FROM public.active_login_sessions
     WHERE user_id = p_user_id
       AND session_id = p_session_id
       AND expires_at > timezone('utc'::text, now())
  );
END;
$$;

-- 7. Grant execution permissions solely to service_role
REVOKE ALL ON FUNCTION public.claim_user_session(UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_user_session(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_user_session(UUID, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_user_session(UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_user_session(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_user_session(UUID, TEXT) TO service_role;
