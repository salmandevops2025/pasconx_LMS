/**
 * Resource URL Validator, Provider Classifier & Security Engine
 * PASCONX LMS - External Study Materials & Resource Links Management System
 */

// Supported Categories
export const RESOURCE_CATEGORIES = [
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
];

// Supported Providers
export const RESOURCE_PROVIDERS = [
  'google_drive',
  'onedrive',
  'dropbox',
  'direct_url',
  'other'
];

// Supported File Types
export const FILE_TYPES = [
  'PDF',
  'DOCX',
  'DOC',
  'XLSX',
  'XLS',
  'PPTX',
  'PPT',
  'ZIP',
  'LINK',
  'OTHER'
];

// Supported Visibility
export const VISIBILITY_OPTIONS = [
  'all_enrolled',
  'course_only',
  'module_only',
  'draft'
];

// Supported Publish Status
export const PUBLISH_STATUSES = [
  'draft',
  'published',
  'archived'
];

// Supported Access Types
export const ACCESS_TYPES = [
  'open_in_tab',
  'direct_download',
  'view_details'
];

/**
 * Checks if a hostname resolves to a private / loopback / local network (SSRF Guard)
 */
function isPrivateOrLocalHost(hostname) {
  if (!hostname) return true;
  const host = hostname.toLowerCase().trim();

  // Localhost aliases
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host === '[::1]' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }

  // IPv4 Private address ranges (RFC 1918 & RFC 3927)
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1, 5).map(Number);
    // 127.0.0.0/8 (loopback)
    if (octets[0] === 127) return true;
    // 10.0.0.0/8 (private)
    if (octets[0] === 10) return true;
    // 172.16.0.0/12 (private)
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    // 192.168.0.0/16 (private)
    if (octets[0] === 192 && octets[1] === 168) return true;
    // 169.254.0.0/16 (link-local)
    if (octets[0] === 169 && octets[1] === 254) return true;
    // 0.0.0.0/8
    if (octets[0] === 0) return true;
  }

  return false;
}

/**
 * Strips dangerous HTML tags and scripts to prevent stored XSS.
 */
export function sanitizeText(input, maxLength = 5000) {
  if (input === null || input === undefined) return '';
  if (typeof input !== 'string') input = String(input);

  let clean = input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();

  if (clean.length > maxLength) {
    clean = clean.substring(0, maxLength);
  }
  return clean;
}

/**
 * Extract Google Drive file/doc/sheet/slide ID and detect item kind
 */
export function parseGoogleDriveUrl(urlObj) {
  const host = urlObj.hostname.replace(/^www\./, '').toLowerCase();
  const path = urlObj.pathname;

  if (host !== 'drive.google.com' && host !== 'docs.google.com') {
    return null;
  }

  // 1. Google Drive direct file: /file/d/{id}
  const fileMatch = path.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch && fileMatch[1]) {
    const fileId = fileMatch[1];
    return {
      isGoogleDrive: true,
      kind: 'file',
      fileId,
      canDirectDownload: true,
      directDownloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
      previewUrl: `https://drive.google.com/file/d/${fileId}/view`,
      permissionNotice: 'Google Drive files require that the file is shared with "Anyone with the link can view" (or shared directly with student Google accounts).'
    };
  }

  // 2. Google Drive open/uc by query param: ?id={id}
  const idParam = urlObj.searchParams.get('id');
  if (idParam && /^[a-zA-Z0-9_-]{15,60}$/.test(idParam)) {
    return {
      isGoogleDrive: true,
      kind: 'file',
      fileId: idParam,
      canDirectDownload: true,
      directDownloadUrl: `https://drive.google.com/uc?export=download&id=${idParam}`,
      previewUrl: `https://drive.google.com/file/d/${idParam}/view`,
      permissionNotice: 'Google Drive files require that the file is shared with "Anyone with the link can view" (or shared directly with student Google accounts).'
    };
  }

  // 3. Google Docs: /document/d/{id}
  const docMatch = path.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (docMatch && docMatch[1]) {
    const docId = docMatch[1];
    return {
      isGoogleDrive: true,
      kind: 'document',
      fileId: docId,
      canDirectDownload: false,
      directDownloadUrl: `https://docs.google.com/document/d/${docId}/export?format=pdf`,
      previewUrl: `https://docs.google.com/document/d/${docId}/view`,
      permissionNotice: 'Google Docs documents open directly in Google Workspace. Ensure share settings allow viewing.'
    };
  }

  // 4. Google Sheets: /spreadsheets/d/{id}
  const sheetMatch = path.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (sheetMatch && sheetMatch[1]) {
    const sheetId = sheetMatch[1];
    return {
      isGoogleDrive: true,
      kind: 'spreadsheet',
      fileId: sheetId,
      canDirectDownload: false,
      directDownloadUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`,
      previewUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/view`,
      permissionNotice: 'Google Sheets spreadsheets open directly in Google Workspace. Ensure share settings allow viewing.'
    };
  }

  // 5. Google Slides: /presentation/d/{id}
  const slideMatch = path.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
  if (slideMatch && slideMatch[1]) {
    const slideId = slideMatch[1];
    return {
      isGoogleDrive: true,
      kind: 'presentation',
      fileId: slideId,
      canDirectDownload: false,
      directDownloadUrl: `https://docs.google.com/presentation/d/${slideId}/export/pdf`,
      previewUrl: `https://docs.google.com/presentation/d/${slideId}/view`,
      permissionNotice: 'Google Slides presentations open directly in Google Workspace. Ensure share settings allow viewing.'
    };
  }

  // 6. Google Drive Folders: /drive/folders/{id}
  const folderMatch = path.match(/\/drive\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch && folderMatch[1]) {
    const folderId = folderMatch[1];
    return {
      isGoogleDrive: true,
      kind: 'folder',
      fileId: folderId,
      canDirectDownload: false,
      directDownloadUrl: null,
      previewUrl: `https://drive.google.com/drive/folders/${folderId}`,
      permissionNotice: 'Google Drive folder requires appropriate sharing permissions for students.'
    };
  }

  return {
    isGoogleDrive: true,
    kind: 'generic',
    fileId: null,
    canDirectDownload: false,
    directDownloadUrl: null,
    previewUrl: urlObj.toString(),
    permissionNotice: 'Google Drive item requires appropriate sharing permissions for students.'
  };
}

/**
 * Classifies the URL to automatically infer provider, file type, and direct download ability
 */
export function classifyResourceUrl(rawUrl, manualProvider = null, manualFileType = null) {
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (e) {
    return {
      ok: false,
      error: 'Invalid URL format. Please provide a full URL starting with https://'
    };
  }

  // 1. Protocol validation: HTTPS only
  if (parsed.protocol !== 'https:') {
    return {
      ok: false,
      error: 'Security requirement: Only secure HTTPS URLs (https://) are allowed.'
    };
  }

  // 2. Reject SSRF / Localhost / Private Network
  if (isPrivateOrLocalHost(parsed.hostname)) {
    return {
      ok: false,
      error: 'Security violation: Localhost, loopback, or private internal IP addresses are prohibited.'
    };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const pathname = parsed.pathname.toLowerCase();

  let autoProvider = 'other';
  let autoFileType = 'LINK';
  let canDirectDownload = false;
  let directDownloadUrl = null;
  let permissionNotice = null;
  let resourceId = null;

  // 3. Provider Detection
  // --- Google Drive & Docs ---
  if (hostname === 'drive.google.com' || hostname === 'docs.google.com') {
    autoProvider = 'google_drive';
    const driveInfo = parseGoogleDriveUrl(parsed);
    if (driveInfo) {
      resourceId = driveInfo.fileId;
      canDirectDownload = driveInfo.canDirectDownload;
      directDownloadUrl = driveInfo.directDownloadUrl;
      permissionNotice = driveInfo.permissionNotice;

      if (driveInfo.kind === 'document') autoFileType = 'DOCX';
      else if (driveInfo.kind === 'spreadsheet') autoFileType = 'XLSX';
      else if (driveInfo.kind === 'presentation') autoFileType = 'PPTX';
      else autoFileType = 'PDF';
    }
  }
  // --- Microsoft OneDrive / SharePoint ---
  else if (
    hostname === 'onedrive.live.com' ||
    hostname === '1drv.ms' ||
    hostname.endsWith('.sharepoint.com')
  ) {
    autoProvider = 'onedrive';
    permissionNotice = 'OneDrive links open in Microsoft 365 or OneDrive. The administrator must grant access to "Anyone with link" or authorized students.';
    if (pathname.endsWith('.pdf')) autoFileType = 'PDF';
    else if (pathname.endsWith('.docx') || pathname.endsWith('.doc')) autoFileType = 'DOCX';
    else if (pathname.endsWith('.xlsx') || pathname.endsWith('.xls')) autoFileType = 'XLSX';
    else if (pathname.endsWith('.pptx') || pathname.endsWith('.ppt')) autoFileType = 'PPTX';
    else if (pathname.endsWith('.zip')) autoFileType = 'ZIP';
  }
  // --- Dropbox ---
  else if (hostname === 'dropbox.com' || hostname === 'dl.dropboxusercontent.com') {
    autoProvider = 'dropbox';
    canDirectDownload = true;
    permissionNotice = 'Dropbox resource. Ensure public link permissions are active.';
    // Convert ?dl=0 to ?dl=1 for direct download
    const dbUrl = new URL(parsed.toString());
    dbUrl.searchParams.set('dl', '1');
    directDownloadUrl = dbUrl.toString();

    if (pathname.endsWith('.pdf')) autoFileType = 'PDF';
    else if (pathname.endsWith('.docx') || pathname.endsWith('.doc')) autoFileType = 'DOCX';
    else if (pathname.endsWith('.xlsx') || pathname.endsWith('.xls')) autoFileType = 'XLSX';
    else if (pathname.endsWith('.pptx') || pathname.endsWith('.ppt')) autoFileType = 'PPTX';
    else if (pathname.endsWith('.zip')) autoFileType = 'ZIP';
  }
  // --- Direct File URLs ---
  else {
    const extMatch = pathname.match(/\.(pdf|docx|doc|xlsx|xls|pptx|ppt|zip|rar|7z|tar|gz)$/i);
    if (extMatch) {
      autoProvider = 'direct_url';
      canDirectDownload = true;
      directDownloadUrl = parsed.toString();
      const ext = extMatch[1].toUpperCase();
      if (ext === 'DOC' || ext === 'DOCX') autoFileType = 'DOCX';
      else if (ext === 'XLS' || ext === 'XLSX') autoFileType = 'XLSX';
      else if (ext === 'PPT' || ext === 'PPTX') autoFileType = 'PPTX';
      else if (['ZIP', 'RAR', '7Z', 'TAR', 'GZ'].includes(ext)) autoFileType = 'ZIP';
      else autoFileType = ext;
    }
  }

  const finalProvider = manualProvider && RESOURCE_PROVIDERS.includes(manualProvider)
    ? manualProvider
    : autoProvider;

  const finalFileType = manualFileType && FILE_TYPES.includes(manualFileType.toUpperCase())
    ? manualFileType.toUpperCase()
    : autoFileType;

  // Extract display file name if not provided
  let inferredFileName = '';
  const pathParts = parsed.pathname.split('/').filter(Boolean);
  if (pathParts.length > 0) {
    const last = pathParts[pathParts.length - 1];
    if (last.includes('.')) {
      inferredFileName = decodeURIComponent(last);
    }
  }

  return {
    ok: true,
    normalizedUrl: parsed.toString(),
    provider: finalProvider,
    fileType: finalFileType,
    inferredFileName,
    resourceId,
    canDirectDownload,
    directDownloadUrl: canDirectDownload ? directDownloadUrl : null,
    permissionNotice
  };
}

/**
 * Complete Validation for Resource Payload (Admin Add/Edit)
 */
export function validateResourcePayload(body) {
  const errors = [];

  const title = sanitizeText(body.title, 200);
  if (!title) {
    errors.push('Resource Title is required (up to 200 characters).');
  }

  const description = sanitizeText(body.description, 2000);
  const courseId = body.course_id !== undefined && body.course_id !== null ? Number(body.course_id) : null;
  if (!courseId || isNaN(courseId) || courseId <= 0) {
    errors.push('Valid Course ID is required.');
  }

  const moduleName = sanitizeText(body.module_name || body.topic || '', 100) || null;
  const moduleId = sanitizeText(body.module_id || '', 100) || null;

  const category = (body.resource_category || '').trim();
  if (!category || !RESOURCE_CATEGORIES.includes(category)) {
    errors.push(`Resource Category must be one of: ${RESOURCE_CATEGORIES.join(', ')}.`);
  }

  const rawUrl = (body.resource_url || '').trim();
  if (!rawUrl) {
    errors.push('External Resource URL is required.');
  }

  // URL security and classification check
  let classification = null;
  if (rawUrl) {
    classification = classifyResourceUrl(rawUrl, body.provider, body.file_type);
    if (!classification.ok) {
      errors.push(classification.error);
    }
  }

  const provider = classification?.provider || (body.provider && RESOURCE_PROVIDERS.includes(body.provider) ? body.provider : 'other');
  const fileType = classification?.fileType || (body.file_type ? body.file_type.toUpperCase() : 'PDF');

  const displayFileName = sanitizeText(body.display_file_name || classification?.inferredFileName || '', 150) || null;

  let accessType = (body.access_type || '').trim().toLowerCase();
  if (!accessType || !ACCESS_TYPES.includes(accessType)) {
    accessType = classification?.canDirectDownload ? 'direct_download' : 'open_in_tab';
  }

  let visibility = (body.visibility || 'all_enrolled').trim().toLowerCase();
  if (!VISIBILITY_OPTIONS.includes(visibility)) {
    visibility = 'all_enrolled';
  }

  let publishStatus = (body.publish_status || 'published').trim().toLowerCase();
  if (!PUBLISH_STATUSES.includes(publishStatus)) {
    publishStatus = 'published';
  }

  const displayOrder = Number.isInteger(Number(body.display_order)) ? Number(body.display_order) : 0;
  const isActive = body.is_active !== undefined ? Boolean(body.is_active) : true;

  if (errors.length > 0) {
    return {
      isValid: false,
      errors
    };
  }

  return {
    isValid: true,
    data: {
      course_id: courseId,
      module_id: moduleId,
      module_name: moduleName,
      title,
      description,
      resource_url: classification.normalizedUrl,
      provider,
      resource_category: category,
      file_type: fileType,
      display_file_name: displayFileName,
      access_type: accessType,
      visibility,
      display_order: displayOrder,
      is_active: isActive,
      publish_status: publishStatus,
      // Metadata for client response
      can_direct_download: classification.canDirectDownload,
      direct_download_url: classification.directDownloadUrl,
      permission_notice: classification.permissionNotice
    }
  };
}
