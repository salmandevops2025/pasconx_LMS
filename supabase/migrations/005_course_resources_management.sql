-- ==============================================================================
-- PASCONX LMS & Video Portal — Migration 005
-- Feature: External Study Materials & Resource Links Management System
-- File: supabase/migrations/005_course_resources_management.sql
-- Environment Target: PASCONX DEV (Project: xorwviktjzftdfkciknj)
-- Zero Data Loss: Strictly Additive & Non-Destructive
-- ==============================================================================

-- 1. Create course_resources table
CREATE TABLE IF NOT EXISTS public.course_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id BIGINT NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  module_id TEXT DEFAULT NULL,
  module_name TEXT DEFAULT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT NULL,
  resource_url TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google_drive', 'onedrive', 'dropbox', 'direct_url', 'other')),
  resource_category TEXT NOT NULL CHECK (
    resource_category IN (
      'PDF Notes',
      'Lecture Notes',
      'Assignments',
      'Question Papers',
      'Interview Materials',
      'Presentations',
      'Practical Exercises',
      'Reference Documents',
      'Projects',
      'Other Resources'
    )
  ),
  file_type TEXT NOT NULL DEFAULT 'PDF',
  display_file_name TEXT DEFAULT NULL,
  access_type TEXT NOT NULL DEFAULT 'open_in_tab' CHECK (
    access_type IN ('open_in_tab', 'direct_download', 'view_details')
  ),
  visibility TEXT NOT NULL DEFAULT 'all_enrolled' CHECK (
    visibility IN ('all_enrolled', 'course_only', 'module_only', 'draft')
  ),
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  publish_status TEXT NOT NULL DEFAULT 'published' CHECK (
    publish_status IN ('draft', 'published', 'archived')
  ),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.course_resources IS 'External study materials, cloud document links, and downloadable resources course-wise';
COMMENT ON COLUMN public.course_resources.module_name IS 'Topic/Module label for grouping resources within a course';
COMMENT ON COLUMN public.course_resources.access_type IS 'Action behavior: open external tab, direct binary download, or view info modal';

-- 2. Performance & Security Indexes
CREATE INDEX IF NOT EXISTS idx_course_resources_course_order 
  ON public.course_resources (course_id, display_order ASC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_course_resources_status 
  ON public.course_resources (course_id, publish_status, is_active, visibility);

CREATE INDEX IF NOT EXISTS idx_course_resources_module 
  ON public.course_resources (course_id, module_name);

CREATE INDEX IF NOT EXISTS idx_course_resources_category 
  ON public.course_resources (course_id, resource_category);

CREATE INDEX IF NOT EXISTS idx_course_resources_created_by 
  ON public.course_resources (created_by);

-- 3. Automatic updated_at Trigger
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_course_resources_updated_at') THEN
    CREATE TRIGGER trg_course_resources_updated_at 
      BEFORE UPDATE ON public.course_resources 
      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END $$;

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.course_resources ENABLE ROW LEVEL SECURITY;

-- 5. Row Level Security Policies

-- Administrators: Full control over all resources
DROP POLICY IF EXISTS "course_resources_admin_all" ON public.course_resources;
CREATE POLICY "course_resources_admin_all" ON public.course_resources
  FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

-- Students: Read-only access strictly for active, published resources in validly enrolled courses
DROP POLICY IF EXISTS "course_resources_student_select" ON public.course_resources;
CREATE POLICY "course_resources_student_select" ON public.course_resources
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    AND publish_status = 'published'
    AND visibility IN ('all_enrolled', 'course_only', 'module_only')
    AND (SELECT public.has_active_course_enrollment(course_id))
  );
