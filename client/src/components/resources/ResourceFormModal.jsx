import React, { useState, useEffect } from 'react';
import Modal from '../common/Modal.jsx';
import api from '../../api/client.js';
import ProviderBadge, { getFileTypeMeta } from './ProviderBadge.jsx';
import { 
  Link2, 
  FileText, 
  BookOpen, 
  Layers, 
  Tag, 
  Eye, 
  Download, 
  ExternalLink, 
  CheckCircle2, 
  AlertCircle,
  HelpCircle,
  Sparkles
} from 'lucide-react';

const CATEGORIES = [
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

const PROVIDERS = [
  { value: 'google_drive', label: 'Google Drive' },
  { value: 'onedrive', label: 'OneDrive / SharePoint' },
  { value: 'dropbox', label: 'Dropbox' },
  { value: 'direct_url', label: 'Direct File URL' },
  { value: 'other', label: 'Other Web Destination' }
];

const FILE_TYPES = ['PDF', 'DOCX', 'DOC', 'XLSX', 'XLS', 'PPTX', 'PPT', 'ZIP', 'LINK', 'OTHER'];
const VISIBILITY_OPTIONS = [
  { value: 'all_enrolled', label: 'All Enrolled Students' },
  { value: 'course_only', label: 'Selected Course Only' },
  { value: 'module_only', label: 'Selected Module Only' },
  { value: 'draft', label: 'Draft (Admin Only)' }
];
const PUBLISH_STATUSES = [
  { value: 'published', label: 'Published (Live)' },
  { value: 'draft', label: 'Draft (Hidden)' },
  { value: 'archived', label: 'Archived' }
];

export default function ResourceFormModal({
  isOpen,
  onClose,
  resource = null,
  courses = [],
  onSaved
}) {
  const isEditing = Boolean(resource?.id);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    course_id: '',
    module_name: '',
    resource_category: 'PDF Notes',
    resource_url: '',
    provider: 'google_drive',
    file_type: 'PDF',
    display_file_name: '',
    access_type: 'open_in_tab',
    visibility: 'all_enrolled',
    display_order: 0,
    publish_status: 'published',
    is_active: true
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [urlPreview, setUrlPreview] = useState(null);
  const [urlError, setUrlError] = useState('');
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    if (resource) {
      setFormData({
        title: resource.title || '',
        description: resource.description || '',
        course_id: resource.course_id || (courses[0]?.id || ''),
        module_name: resource.module_name || '',
        resource_category: resource.resource_category || 'PDF Notes',
        resource_url: resource.resource_url || '',
        provider: resource.provider || 'google_drive',
        file_type: resource.file_type || 'PDF',
        display_file_name: resource.display_file_name || '',
        access_type: resource.access_type || 'open_in_tab',
        visibility: resource.visibility || 'all_enrolled',
        display_order: resource.display_order || 0,
        publish_status: resource.publish_status || 'published',
        is_active: resource.is_active !== undefined ? resource.is_active : true
      });
      if (resource.resource_url) {
        checkUrlPreview(resource.resource_url, resource.provider, resource.file_type);
      }
    } else {
      setFormData({
        title: '',
        description: '',
        course_id: courses[0]?.id || '',
        module_name: '',
        resource_category: 'PDF Notes',
        resource_url: '',
        provider: 'google_drive',
        file_type: 'PDF',
        display_file_name: '',
        access_type: 'open_in_tab',
        visibility: 'all_enrolled',
        display_order: 0,
        publish_status: 'published',
        is_active: true
      });
      setUrlPreview(null);
      setUrlError('');
    }
    setError('');
  }, [resource, isOpen, courses]);

  // Live URL inspection and classification
  const checkUrlPreview = async (url, provider, fileType) => {
    if (!url || !url.trim().startsWith('https://')) {
      setUrlPreview(null);
      if (url && !url.trim().startsWith('https://')) {
        setUrlError('Only secure https:// URLs are permitted.');
      } else {
        setUrlError('');
      }
      return;
    }

    setDetecting(true);
    setUrlError('');
    try {
      const res = await api.post('/admin/resources/preview', {
        url: url.trim(),
        provider,
        file_type: fileType
      });
      if (res.success && res.preview) {
        setUrlPreview(res.preview);
        // Auto-update provider and file type if user hasn't explicitly set them
        setFormData(prev => ({
          ...prev,
          provider: res.preview.provider,
          file_type: res.preview.fileType,
          access_type: res.preview.canDirectDownload ? 'direct_download' : 'open_in_tab',
          display_file_name: prev.display_file_name || res.preview.inferredFileName || ''
        }));
      }
    } catch (err) {
      setUrlError(err.message || 'Invalid or untrusted resource URL.');
      setUrlPreview(null);
    } finally {
      setDetecting(false);
    }
  };

  const handleUrlBlur = () => {
    if (formData.resource_url) {
      checkUrlPreview(formData.resource_url, formData.provider, formData.file_type);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.title.trim()) {
      setError('Please provide a resource title.');
      return;
    }
    if (!formData.course_id) {
      setError('Please select a course.');
      return;
    }
    if (!formData.resource_url.trim()) {
      setError('External resource URL is required.');
      return;
    }

    setLoading(true);
    try {
      if (isEditing) {
        await api.put(`/admin/resources/${resource.id}`, formData);
      } else {
        await api.post('/admin/resources', formData);
      }
      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save resource link.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit Study Material / Resource' : 'Add External Study Material / Resource'}
      maxWidth="max-w-3xl"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Section 1: Core Details */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              Resource Title <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="e.g. CI/CD Pipeline Complete Architecture Notes"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs sm:text-sm focus:ring-2 focus:ring-brand-500 focus:outline-none transition-all"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                Assign to Course <span className="text-rose-500">*</span>
              </label>
              <select
                required
                value={formData.course_id}
                onChange={(e) => setFormData({ ...formData, course_id: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs sm:text-sm focus:ring-2 focus:ring-brand-500 focus:outline-none transition-all"
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                Module / Topic <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                value={formData.module_name}
                onChange={(e) => setFormData({ ...formData, module_name: e.target.value })}
                placeholder="e.g. CI/CD, Docker, Interview Prep"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs sm:text-sm focus:ring-2 focus:ring-brand-500 focus:outline-none transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              Description & Student Instructions
            </label>
            <textarea
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Provide instructions on what students should study, lab steps, or required tools..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs sm:text-sm focus:ring-2 focus:ring-brand-500 focus:outline-none transition-all"
            />
          </div>
        </div>

        {/* Section 2: External Link & URL Classifier */}
        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Link2 className="w-4 h-4 text-brand-600 dark:text-cyan-400" />
              External Destination & Provider
            </span>
            {detecting && (
              <span className="text-[11px] font-semibold text-brand-600 dark:text-cyan-400 flex items-center gap-1 animate-pulse">
                <Sparkles className="w-3.5 h-3.5" />
                Auto-detecting...
              </span>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
              External Resource URL <span className="text-rose-500">*</span>
            </label>
            <input
              type="url"
              required
              value={formData.resource_url}
              onChange={(e) => setFormData({ ...formData, resource_url: e.target.value })}
              onBlur={handleUrlBlur}
              placeholder="https://drive.google.com/file/d/... or OneDrive, Dropbox, PDF link"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs sm:text-sm font-mono focus:ring-2 focus:ring-brand-500 focus:outline-none transition-all"
            />
            {urlError && (
              <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 mt-1 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                {urlError}
              </p>
            )}
          </div>

          {/* Real-time Preview Pill */}
          {urlPreview && (
            <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <ProviderBadge provider={urlPreview.provider} />
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {urlPreview.fileType}
                </span>
                {urlPreview.canDirectDownload && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    <Download className="w-3 h-3" />
                    Direct Download Available
                  </span>
                )}
              </div>
              <a
                href={urlPreview.normalizedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 dark:text-cyan-400 font-bold hover:underline inline-flex items-center gap-1 shrink-0"
              >
                Test Link <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

          {/* Provider & Category Selectors */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Category
              </label>
              <select
                value={formData.resource_category}
                onChange={(e) => setFormData({ ...formData, resource_category: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs sm:text-sm text-slate-800 dark:text-slate-200"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Provider Override
              </label>
              <select
                value={formData.provider}
                onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs sm:text-sm text-slate-800 dark:text-slate-200"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                File Type
              </label>
              <select
                value={formData.file_type}
                onChange={(e) => setFormData({ ...formData, file_type: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs sm:text-sm text-slate-800 dark:text-slate-200"
              >
                {FILE_TYPES.map((ft) => (
                  <option key={ft} value={ft}>{ft}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Display File Name <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                value={formData.display_file_name}
                onChange={(e) => setFormData({ ...formData, display_file_name: e.target.value })}
                placeholder="e.g. Jenkins_Notes_v2.pdf"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs sm:text-sm text-slate-800 dark:text-slate-200"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Access Behavior
              </label>
              <select
                value={formData.access_type}
                onChange={(e) => setFormData({ ...formData, access_type: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs sm:text-sm text-slate-800 dark:text-slate-200"
              >
                <option value="open_in_tab">Open Resource in New Tab</option>
                <option value="direct_download">Direct Download & Open</option>
                <option value="view_details">View Details Modal Only</option>
              </select>
            </div>
          </div>
        </div>

        {/* Section 3: Visibility, Order & Publishing */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              Visibility Scope
            </label>
            <select
              value={formData.visibility}
              onChange={(e) => setFormData({ ...formData, visibility: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs sm:text-sm text-slate-800 dark:text-slate-200"
            >
              {VISIBILITY_OPTIONS.map((v) => (
                <option key={v.value} value={v.value}>{v.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              Publish Status
            </label>
            <select
              value={formData.publish_status}
              onChange={(e) => setFormData({ ...formData, publish_status: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs sm:text-sm text-slate-800 dark:text-slate-200"
            >
              {PUBLISH_STATUSES.map((ps) => (
                <option key={ps.value} value={ps.value}>{ps.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              Display Order
            </label>
            <input
              type="number"
              value={formData.display_order}
              onChange={(e) => setFormData({ ...formData, display_order: Number(e.target.value) })}
              min={0}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs sm:text-sm text-slate-800 dark:text-slate-200"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-brand-600 hover:bg-brand-500 text-white shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            <span>{isEditing ? 'Save Changes' : 'Publish Resource'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
