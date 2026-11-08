import crypto from 'crypto';
import { db } from '../config/database.js';
import { supabase, isSupabase } from '../config/supabase.js';
import { logSecurityEvent } from '../utils/auditLogger.js';
import {
  validateResourcePayload,
  classifyResourceUrl,
  RESOURCE_CATEGORIES,
  RESOURCE_PROVIDERS,
  FILE_TYPES,
  VISIBILITY_OPTIONS,
  PUBLISH_STATUSES
} from '../utils/resourceValidator.js';

// ==============================================================================
// HELPER: Enrich resource object with dynamic URLs & security actions
// ==============================================================================
function enrichResourceForClient(res) {
  if (!res) return null;
  const classification = classifyResourceUrl(res.resource_url, res.provider, res.file_type);

  const canDownload = res.access_type === 'direct_download' || classification.canDirectDownload;
  const downloadUrl = canDownload ? (classification.directDownloadUrl || res.resource_url) : null;

  return {
    ...res,
    can_download: canDownload,
    download_url: downloadUrl,
    open_url: res.resource_url,
    permission_notice: classification.permissionNotice || null,
    resource_id: classification.resourceId || null
  };
}

// ==============================================================================
// 1. ADMIN CONTROLLERS - SQLITE IMPLEMENTATION
// ==============================================================================

function getAdminResourcesSqlite(req, res, next) {
  try {
    const { course_id, category, provider, publish_status, search } = req.query;

    let query = `
      SELECT r.*, c.title AS course_title
      FROM course_resources r
      JOIN courses c ON c.id = r.course_id
      WHERE 1=1
    `;
    const params = [];

    if (course_id) {
      query += ` AND r.course_id = ?`;
      params.push(Number(course_id));
    }
    if (category) {
      query += ` AND r.resource_category = ?`;
      params.push(category);
    }
    if (provider) {
      query += ` AND r.provider = ?`;
      params.push(provider);
    }
    if (publish_status) {
      query += ` AND r.publish_status = ?`;
      params.push(publish_status);
    }
    if (search && search.trim()) {
      query += ` AND (r.title LIKE ? OR r.description LIKE ? OR r.module_name LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    query += ` ORDER BY r.course_id ASC, r.display_order ASC, r.created_at DESC`;

    const resources = db.prepare(query).all(...params).map(enrichResourceForClient);

    return res.json({
      success: true,
      resources
    });
  } catch (error) {
    next(error);
  }
}

function getAdminResourceStatsSqlite(req, res, next) {
  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM course_resources').get().count;
    const published = db.prepare("SELECT COUNT(*) as count FROM course_resources WHERE publish_status = 'published'").get().count;
    const draft = db.prepare("SELECT COUNT(*) as count FROM course_resources WHERE publish_status = 'draft'").get().count;
    const archived = db.prepare("SELECT COUNT(*) as count FROM course_resources WHERE publish_status = 'archived'").get().count;

    const byCourse = db.prepare(`
      SELECT c.id as course_id, c.title as course_title, COUNT(r.id) as count
      FROM courses c
      LEFT JOIN course_resources r ON r.course_id = c.id
      GROUP BY c.id, c.title
      ORDER BY count DESC, c.title ASC
    `).all();

    const recent = db.prepare(`
      SELECT r.*, c.title AS course_title
      FROM course_resources r
      JOIN courses c ON c.id = r.course_id
      ORDER BY r.created_at DESC
      LIMIT 5
    `).all().map(enrichResourceForClient);

    return res.json({
      success: true,
      stats: {
        total,
        published,
        draft,
        archived,
        byCourse,
        recent
      }
    });
  } catch (error) {
    next(error);
  }
}

function createResourceSqlite(req, res, next) {
  try {
    const validation = validateResourcePayload(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: validation.errors.join(' ')
      });
    }

    const {
      course_id,
      module_id,
      module_name,
      title,
      description,
      resource_url,
      provider,
      resource_category,
      file_type,
      display_file_name,
      access_type,
      visibility,
      display_order,
      is_active,
      publish_status
    } = validation.data;

    // Verify course exists
    const course = db.prepare('SELECT id, title FROM courses WHERE id = ?').get(course_id);
    if (!course) {
      return res.status(404).json({ success: false, error: 'Course not found.' });
    }

    const id = crypto.randomUUID();
    const createdBy = req.user?.id ? String(req.user.id) : null;

    db.prepare(`
      INSERT INTO course_resources (
        id, course_id, module_id, module_name, title, description, resource_url,
        provider, resource_category, file_type, display_file_name, access_type,
        visibility, display_order, is_active, publish_status, created_by,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      id,
      course_id,
      module_id,
      module_name,
      title,
      description,
      resource_url,
      provider,
      resource_category,
      file_type,
      display_file_name,
      access_type,
      visibility,
      display_order,
      is_active ? 1 : 0,
      publish_status,
      createdBy
    );

    const resource = enrichResourceForClient(
      db.prepare(`
        SELECT r.*, c.title AS course_title
        FROM course_resources r
        JOIN courses c ON c.id = r.course_id
        WHERE r.id = ?
      `).get(id)
    );

    logSecurityEvent({
      userId: req.user?.id,
      eventType: 'RESOURCE_CREATED',
      resourceType: 'course_resource',
      resourceId: id,
      req,
      status: 'SUCCESS',
      details: {
        operation: 'create',
        title,
        course_id,
        provider,
        publish_status
      }
    });

    return res.status(201).json({
      success: true,
      message: 'Resource link created successfully.',
      resource
    });
  } catch (error) {
    next(error);
  }
}

function updateResourceSqlite(req, res, next) {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM course_resources WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Resource not found.' });
    }

    const merged = {
      ...existing,
      ...req.body,
      is_active: req.body.is_active !== undefined ? req.body.is_active : (existing.is_active === 1 || existing.is_active === true)
    };

    const validation = validateResourcePayload(merged);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: validation.errors.join(' ')
      });
    }

    const {
      course_id,
      module_id,
      module_name,
      title,
      description,
      resource_url,
      provider,
      resource_category,
      file_type,
      display_file_name,
      access_type,
      visibility,
      display_order,
      is_active,
      publish_status
    } = validation.data;

    db.prepare(`
      UPDATE course_resources SET
        course_id = ?,
        module_id = ?,
        module_name = ?,
        title = ?,
        description = ?,
        resource_url = ?,
        provider = ?,
        resource_category = ?,
        file_type = ?,
        display_file_name = ?,
        access_type = ?,
        visibility = ?,
        display_order = ?,
        is_active = ?,
        publish_status = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      course_id,
      module_id,
      module_name,
      title,
      description,
      resource_url,
      provider,
      resource_category,
      file_type,
      display_file_name,
      access_type,
      visibility,
      display_order,
      is_active ? 1 : 0,
      publish_status,
      id
    );

    const updated = enrichResourceForClient(
      db.prepare(`
        SELECT r.*, c.title AS course_title
        FROM course_resources r
        JOIN courses c ON c.id = r.course_id
        WHERE r.id = ?
      `).get(id)
    );

    let eventType = 'RESOURCE_UPDATED';
    if (existing.publish_status !== publish_status) {
      if (publish_status === 'published') eventType = 'RESOURCE_PUBLISHED';
      else if (publish_status === 'archived') eventType = 'RESOURCE_ARCHIVED';
    }

    logSecurityEvent({
      userId: req.user?.id,
      eventType,
      resourceType: 'course_resource',
      resourceId: id,
      req,
      status: 'SUCCESS',
      details: {
        operation: 'update',
        title,
        publish_status,
        is_active
      }
    });

    return res.json({
      success: true,
      message: 'Resource link updated successfully.',
      resource: updated
    });
  } catch (error) {
    next(error);
  }
}

function deleteResourceSqlite(req, res, next) {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT id, title, course_id FROM course_resources WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Resource not found.' });
    }

    db.prepare('DELETE FROM course_resources WHERE id = ?').run(id);

    logSecurityEvent({
      userId: req.user?.id,
      eventType: 'RESOURCE_DELETED',
      resourceType: 'course_resource',
      resourceId: id,
      req,
      status: 'SUCCESS',
      details: {
        operation: 'delete',
        title: existing.title,
        course_id: existing.course_id
      }
    });

    return res.json({
      success: true,
      message: 'Resource deleted successfully.'
    });
  } catch (error) {
    next(error);
  }
}

function reorderResourcesSqlite(req, res, next) {
  try {
    const { items } = req.body; // Array of { id, display_order }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid items array.' });
    }

    const stmt = db.prepare("UPDATE course_resources SET display_order = ?, updated_at = datetime('now') WHERE id = ?");
    const updateMany = db.transaction((list) => {
      for (const item of list) {
        if (item.id && Number.isInteger(Number(item.display_order))) {
          stmt.run(Number(item.display_order), item.id);
        }
      }
    });

    updateMany(items);

    return res.json({
      success: true,
      message: 'Resource order updated successfully.'
    });
  } catch (error) {
    next(error);
  }
}

// ==============================================================================
// 2. ADMIN CONTROLLERS - SUPABASE IMPLEMENTATION
// ==============================================================================

async function getAdminResourcesSupabase(req, res, next) {
  try {
    const { course_id, category, provider, publish_status, search } = req.query;

    let query = supabase
      .from('course_resources')
      .select('*, courses!inner(id, title)')
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: false });

    if (course_id) {
      query = query.eq('course_id', Number(course_id));
    }
    if (category) {
      query = query.eq('resource_category', category);
    }
    if (provider) {
      query = query.eq('provider', provider);
    }
    if (publish_status) {
      query = query.eq('publish_status', publish_status);
    }
    if (search && search.trim()) {
      query = query.ilike('title', `%${search.trim()}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const formatted = (data || []).map((r) => {
      const courseTitle = r.courses?.title || 'Unknown Course';
      return enrichResourceForClient({
        ...r,
        course_title: courseTitle
      });
    });

    return res.json({
      success: true,
      resources: formatted
    });
  } catch (error) {
    next(error);
  }
}

async function getAdminResourceStatsSupabase(req, res, next) {
  try {
    const [totalRes, pubRes, draftRes, archRes, coursesRes, recentRes] = await Promise.all([
      supabase.from('course_resources').select('*', { count: 'exact', head: true }),
      supabase.from('course_resources').select('*', { count: 'exact', head: true }).eq('publish_status', 'published'),
      supabase.from('course_resources').select('*', { count: 'exact', head: true }).eq('publish_status', 'draft'),
      supabase.from('course_resources').select('*', { count: 'exact', head: true }).eq('publish_status', 'archived'),
      supabase.from('courses').select('id, title').order('title', { ascending: true }),
      supabase.from('course_resources')
        .select('*, courses!inner(id, title)')
        .order('created_at', { ascending: false })
        .limit(5)
    ]);

    const total = totalRes.count || 0;
    const published = pubRes.count || 0;
    const draft = draftRes.count || 0;
    const archived = archRes.count || 0;

    // Fetch counts per course
    const { data: allResources } = await supabase.from('course_resources').select('course_id');
    const courseCounts = {};
    (allResources || []).forEach(r => {
      courseCounts[r.course_id] = (courseCounts[r.course_id] || 0) + 1;
    });

    const byCourse = (coursesRes.data || []).map(c => ({
      course_id: c.id,
      course_title: c.title,
      count: courseCounts[c.id] || 0
    })).sort((a, b) => b.count - a.count);

    const recent = (recentRes.data || []).map(r => enrichResourceForClient({
      ...r,
      course_title: r.courses?.title || 'Unknown Course'
    }));

    return res.json({
      success: true,
      stats: {
        total,
        published,
        draft,
        archived,
        byCourse,
        recent
      }
    });
  } catch (error) {
    next(error);
  }
}

async function createResourceSupabase(req, res, next) {
  try {
    const validation = validateResourcePayload(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: validation.errors.join(' ')
      });
    }

    const {
      course_id,
      module_id,
      module_name,
      title,
      description,
      resource_url,
      provider,
      resource_category,
      file_type,
      display_file_name,
      access_type,
      visibility,
      display_order,
      is_active,
      publish_status
    } = validation.data;

    // Verify course
    const { data: course, error: cErr } = await supabase
      .from('courses')
      .select('id, title')
      .eq('id', course_id)
      .maybeSingle();

    if (cErr || !course) {
      return res.status(404).json({ success: false, error: 'Course not found.' });
    }

    const createdBy = req.user?.id ? String(req.user.id) : null;

    const { data: inserted, error: iErr } = await supabase
      .from('course_resources')
      .insert({
        course_id,
        module_id,
        module_name,
        title,
        description,
        resource_url,
        provider,
        resource_category,
        file_type,
        display_file_name,
        access_type,
        visibility,
        display_order,
        is_active,
        publish_status,
        created_by: createdBy
      })
      .select('*, courses!inner(id, title)')
      .single();

    if (iErr) throw iErr;

    const resource = enrichResourceForClient({
      ...inserted,
      course_title: inserted.courses?.title || course.title
    });

    logSecurityEvent({
      userId: req.user?.id,
      eventType: 'RESOURCE_CREATED',
      resourceType: 'course_resource',
      resourceId: resource.id,
      req,
      status: 'SUCCESS',
      details: {
        operation: 'create',
        title,
        course_id,
        provider,
        publish_status
      }
    });

    return res.status(201).json({
      success: true,
      message: 'Resource link created successfully.',
      resource
    });
  } catch (error) {
    next(error);
  }
}

async function updateResourceSupabase(req, res, next) {
  try {
    const { id } = req.params;

    const { data: existing, error: eErr } = await supabase
      .from('course_resources')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (eErr || !existing) {
      return res.status(404).json({ success: false, error: 'Resource not found.' });
    }

    const merged = {
      ...existing,
      ...req.body
    };

    const validation = validateResourcePayload(merged);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: validation.errors.join(' ')
      });
    }

    const {
      course_id,
      module_id,
      module_name,
      title,
      description,
      resource_url,
      provider,
      resource_category,
      file_type,
      display_file_name,
      access_type,
      visibility,
      display_order,
      is_active,
      publish_status
    } = validation.data;

    const { data: updated, error: uErr } = await supabase
      .from('course_resources')
      .update({
        course_id,
        module_id,
        module_name,
        title,
        description,
        resource_url,
        provider,
        resource_category,
        file_type,
        display_file_name,
        access_type,
        visibility,
        display_order,
        is_active,
        publish_status,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select('*, courses!inner(id, title)')
      .single();

    if (uErr) throw uErr;

    const resource = enrichResourceForClient({
      ...updated,
      course_title: updated.courses?.title || 'Course'
    });

    let eventType = 'RESOURCE_UPDATED';
    if (existing.publish_status !== publish_status) {
      if (publish_status === 'published') eventType = 'RESOURCE_PUBLISHED';
      else if (publish_status === 'archived') eventType = 'RESOURCE_ARCHIVED';
    }

    logSecurityEvent({
      userId: req.user?.id,
      eventType,
      resourceType: 'course_resource',
      resourceId: id,
      req,
      status: 'SUCCESS',
      details: {
        operation: 'update',
        title,
        publish_status,
        is_active
      }
    });

    return res.json({
      success: true,
      message: 'Resource link updated successfully.',
      resource
    });
  } catch (error) {
    next(error);
  }
}

async function deleteResourceSupabase(req, res, next) {
  try {
    const { id } = req.params;

    const { data: existing, error: eErr } = await supabase
      .from('course_resources')
      .select('id, title, course_id')
      .eq('id', id)
      .maybeSingle();

    if (eErr || !existing) {
      return res.status(404).json({ success: false, error: 'Resource not found.' });
    }

    const { error: dErr } = await supabase
      .from('course_resources')
      .delete()
      .eq('id', id);

    if (dErr) throw dErr;

    logSecurityEvent({
      userId: req.user?.id,
      eventType: 'RESOURCE_DELETED',
      resourceType: 'course_resource',
      resourceId: id,
      req,
      status: 'SUCCESS',
      details: {
        operation: 'delete',
        title: existing.title,
        course_id: existing.course_id
      }
    });

    return res.json({
      success: true,
      message: 'Resource deleted successfully.'
    });
  } catch (error) {
    next(error);
  }
}

async function reorderResourcesSupabase(req, res, next) {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid items array.' });
    }

    // Update each item concurrently
    await Promise.all(
      items.map(async (item) => {
        if (item.id && Number.isInteger(Number(item.display_order))) {
          await supabase
            .from('course_resources')
            .update({ display_order: Number(item.display_order), updated_at: new Date().toISOString() })
            .eq('id', item.id);
        }
      })
    );

    return res.json({
      success: true,
      message: 'Resource order updated successfully.'
    });
  } catch (error) {
    next(error);
  }
}

// ==============================================================================
// 3. STUDENT CONTROLLERS - SQLITE & SUPABASE
// ==============================================================================

function getStudentCourseResourcesSqlite(req, res, next) {
  try {
    const courseId = Number(req.params.courseId);

    const rows = db.prepare(`
      SELECT 
        r.id,
        r.course_id,
        r.module_id,
        r.module_name,
        r.title,
        r.description,
        r.resource_url,
        r.provider,
        r.resource_category,
        r.file_type,
        r.display_file_name,
        r.access_type,
        r.visibility,
        r.display_order,
        r.created_at
      FROM course_resources r
      WHERE r.course_id = ?
        AND r.is_active = 1
        AND r.publish_status = 'published'
        AND r.visibility IN ('all_enrolled', 'course_only', 'module_only')
      ORDER BY r.display_order ASC, r.created_at DESC
    `).all(courseId).map(enrichResourceForClient);

    // Group by module/topic
    const groupedByModule = {};
    const categoriesSet = new Set();

    rows.forEach((r) => {
      const moduleKey = r.module_name || 'General Course Materials';
      if (!groupedByModule[moduleKey]) {
        groupedByModule[moduleKey] = [];
      }
      groupedByModule[moduleKey].push(r);
      categoriesSet.add(r.resource_category);
    });

    return res.json({
      success: true,
      course_id: courseId,
      resources: rows,
      grouped_by_module: groupedByModule,
      categories: Array.from(categoriesSet)
    });
  } catch (error) {
    next(error);
  }
}

async function getStudentCourseResourcesSupabase(req, res, next) {
  try {
    const courseId = Number(req.params.courseId);

    const { data: rows, error } = await supabase
      .from('course_resources')
      .select('id, course_id, module_id, module_name, title, description, resource_url, provider, resource_category, file_type, display_file_name, access_type, visibility, display_order, created_at')
      .eq('course_id', courseId)
      .eq('is_active', true)
      .eq('publish_status', 'published')
      .in('visibility', ['all_enrolled', 'course_only', 'module_only'])
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) throw error;

    const enriched = (rows || []).map(enrichResourceForClient);

    const groupedByModule = {};
    const categoriesSet = new Set();

    enriched.forEach((r) => {
      const moduleKey = r.module_name || 'General Course Materials';
      if (!groupedByModule[moduleKey]) {
        groupedByModule[moduleKey] = [];
      }
      groupedByModule[moduleKey].push(r);
      categoriesSet.add(r.resource_category);
    });

    return res.json({
      success: true,
      course_id: courseId,
      resources: enriched,
      grouped_by_module: groupedByModule,
      categories: Array.from(categoriesSet)
    });
  } catch (error) {
    next(error);
  }
}

function getStudentAllResourcesSqlite(req, res, next) {
  try {
    const studentId = req.user.id;
    const now = new Date().toISOString();

    const resources = db.prepare(`
      SELECT 
        r.id,
        r.course_id,
        r.module_id,
        r.module_name,
        r.title,
        r.description,
        r.resource_url,
        r.provider,
        r.resource_category,
        r.file_type,
        r.display_file_name,
        r.access_type,
        r.visibility,
        r.display_order,
        r.created_at,
        c.title AS course_title
      FROM course_resources r
      JOIN enrollments e ON e.course_id = r.course_id
      JOIN courses c ON c.id = r.course_id
      WHERE e.student_id = ?
        AND e.status = 'ACTIVE'
        AND c.status = 'ACTIVE'
        AND ? >= e.access_start
        AND ? <= e.access_expiry
        AND r.is_active = 1
        AND r.publish_status = 'published'
        AND r.visibility IN ('all_enrolled', 'course_only', 'module_only')
      ORDER BY c.title ASC, r.display_order ASC, r.created_at DESC
    `).all(studentId, now, now).map(enrichResourceForClient);

    return res.json({
      success: true,
      resources
    });
  } catch (error) {
    next(error);
  }
}

async function getStudentAllResourcesSupabase(req, res, next) {
  try {
    const studentId = req.user.id;
    const nowIso = new Date().toISOString();

    // 1. Get active enrolled courses
    const { data: enrollments, error: eErr } = await supabase
      .from('enrollments')
      .select('course_id, courses!inner(id, title, status)')
      .eq('student_id', studentId)
      .eq('status', 'ACTIVE')
      .lte('access_start', nowIso)
      .gte('access_expiry', nowIso);

    if (eErr) throw eErr;

    const activeCourseIds = (enrollments || [])
      .filter(e => e.courses?.status === 'ACTIVE')
      .map(e => e.course_id);

    if (activeCourseIds.length === 0) {
      return res.json({ success: true, resources: [] });
    }

    const courseMap = {};
    (enrollments || []).forEach(e => {
      courseMap[e.course_id] = e.courses?.title || 'Course';
    });

    const { data: resources, error: rErr } = await supabase
      .from('course_resources')
      .select('id, course_id, module_id, module_name, title, description, resource_url, provider, resource_category, file_type, display_file_name, access_type, visibility, display_order, created_at')
      .in('course_id', activeCourseIds)
      .eq('is_active', true)
      .eq('publish_status', 'published')
      .in('visibility', ['all_enrolled', 'course_only', 'module_only'])
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: false });

    if (rErr) throw rErr;

    const enriched = (resources || []).map(r => enrichResourceForClient({
      ...r,
      course_title: courseMap[r.course_id] || 'Course'
    }));

    return res.json({
      success: true,
      resources: enriched
    });
  } catch (error) {
    next(error);
  }
}

// ==============================================================================
// 4. PREVIEW UTILITY (FOR ADMIN ADD/EDIT FORM REAL-TIME VALIDATION)
// ==============================================================================

export function previewResourceLink(req, res) {
  const { url, provider, file_type } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ success: false, error: 'URL is required for preview.' });
  }

  const result = classifyResourceUrl(url, provider, file_type);
  if (!result.ok) {
    return res.status(400).json({ success: false, error: result.error });
  }

  return res.json({
    success: true,
    preview: {
      normalizedUrl: result.normalizedUrl,
      provider: result.provider,
      fileType: result.fileType,
      inferredFileName: result.inferredFileName,
      resourceId: result.resourceId,
      canDirectDownload: result.canDirectDownload,
      directDownloadUrl: result.directDownloadUrl,
      permissionNotice: result.permissionNotice
    }
  });
}

// ==============================================================================
// 5. EXPORT ROUTER HANDLERS WITH BACKEND SELECTOR
// ==============================================================================

export function getAdminResources(req, res, next) {
  if (process.env.DATA_BACKEND === 'supabase') {
    return getAdminResourcesSupabase(req, res, next);
  }
  return getAdminResourcesSqlite(req, res, next);
}

export function getAdminResourceStats(req, res, next) {
  if (process.env.DATA_BACKEND === 'supabase') {
    return getAdminResourceStatsSupabase(req, res, next);
  }
  return getAdminResourceStatsSqlite(req, res, next);
}

export function createResource(req, res, next) {
  if (process.env.DATA_BACKEND === 'supabase') {
    return createResourceSupabase(req, res, next);
  }
  return createResourceSqlite(req, res, next);
}

export function updateResource(req, res, next) {
  if (process.env.DATA_BACKEND === 'supabase') {
    return updateResourceSupabase(req, res, next);
  }
  return updateResourceSqlite(req, res, next);
}

export function deleteResource(req, res, next) {
  if (process.env.DATA_BACKEND === 'supabase') {
    return deleteResourceSupabase(req, res, next);
  }
  return deleteResourceSqlite(req, res, next);
}

export function reorderResources(req, res, next) {
  if (process.env.DATA_BACKEND === 'supabase') {
    return reorderResourcesSupabase(req, res, next);
  }
  return reorderResourcesSqlite(req, res, next);
}

export function getStudentCourseResources(req, res, next) {
  if (process.env.DATA_BACKEND === 'supabase') {
    return getStudentCourseResourcesSupabase(req, res, next);
  }
  return getStudentCourseResourcesSqlite(req, res, next);
}

export function getStudentAllResources(req, res, next) {
  if (process.env.DATA_BACKEND === 'supabase') {
    return getStudentAllResourcesSupabase(req, res, next);
  }
  return getStudentAllResourcesSqlite(req, res, next);
}
