import React, { useState, useEffect } from 'react';
import api from '../../api/client.js';
import ProviderBadge, { getFileTypeMeta } from '../../components/resources/ProviderBadge.jsx';
import ResourceFormModal from '../../components/resources/ResourceFormModal.jsx';
import ResourceDetailsModal from '../../components/resources/ResourceDetailsModal.jsx';
import { 
  FileText, 
  PlusCircle, 
  Search, 
  Filter, 
  ExternalLink, 
  Download, 
  Edit3, 
  Trash2, 
  Eye, 
  CheckCircle2, 
  AlertCircle, 
  Layers, 
  HardDrive, 
  BookOpen, 
  Sparkles,
  ArrowUpDown,
  RefreshCw
} from 'lucide-react';

export default function ResourcesManagement() {
  const [resources, setResources] = useState([]);
  const [courses, setCourses] = useState([]);
  const [stats, setStats] = useState({ total: 0, published: 0, draft: 0, archived: 0, byCourse: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Filters
  const [selectedCourse, setSelectedCourse] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Modals
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingResource, setEditingResource] = useState(null);
  const [viewingResource, setViewingResource] = useState(null);
  const [deletingResource, setDeletingResource] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [resData, statsData, coursesData] = await Promise.all([
        api.get('/admin/resources', {
          params: {
            course_id: selectedCourse || undefined,
            category: selectedCategory || undefined,
            provider: selectedProvider || undefined,
            publish_status: selectedStatus || undefined,
            search: searchTerm || undefined
          }
        }),
        api.get('/admin/resources/stats'),
        api.get('/admin/courses')
      ]);

      if (resData.success) {
        setResources(resData.resources || []);
      }
      if (statsData.success) {
        setStats(statsData.stats || { total: 0, published: 0, draft: 0, archived: 0, byCourse: [] });
      }
      if (coursesData.success) {
        setCourses(coursesData.courses || []);
      }
    } catch (err) {
      setError(err.message || 'Failed to load study materials.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedCourse, selectedCategory, selectedProvider, selectedStatus]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchData();
  };

  const handleEdit = (resource) => {
    setEditingResource(resource);
    setIsFormOpen(true);
  };

  const handleCreate = () => {
    setEditingResource(null);
    setIsFormOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingResource) return;
    try {
      await api.delete(`/admin/resources/${deletingResource.id}`);
      setSuccessMsg('Resource removed successfully.');
      setDeletingResource(null);
      fetchData();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setError(err.message || 'Failed to delete resource.');
    }
  };

  const statCards = [
    { label: 'Total Resources', count: stats.total, color: 'text-brand-600 dark:text-cyan-400', bg: 'bg-brand-50 dark:bg-cyan-950/40 border-brand-200 dark:border-cyan-900/60' },
    { label: 'Published & Live', count: stats.published, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/60' },
    { label: 'Draft Materials', count: stats.draft, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/60' },
    { label: 'Active Courses Covered', count: stats.byCourse?.filter(c => c.count > 0)?.length || 0, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-900/60' }
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-200/60 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold mb-2">
            Academic Content Delivery
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Study Materials & External Resources
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Provide and manage external document links (Google Drive, OneDrive, Dropbox, PDFs) course-wise.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={fetchData}
            className="p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-2xs transition-colors"
            title="Refresh list"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={handleCreate}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-xs transition-colors"
          >
            <PlusCircle className="w-4 h-4" />
            + Add New Resource
          </button>
        </div>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900/60 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Analytics Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-2xs flex items-center justify-between"
          >
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {card.label}
              </span>
              <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
                {card.count}
              </div>
            </div>
            <div className={`p-2.5 rounded-xl border ${card.bg}`}>
              <FileText className={`w-5 h-5 ${card.color}`} />
            </div>
          </div>
        ))}
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-2xs space-y-3">
        <form onSubmit={handleSearchSubmit} className="flex flex-col md:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search resources by title, description or module..."
              className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-xs sm:text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full md:w-auto">
            {/* Course Filter */}
            <select
              value={selectedCourse}
              onChange={(e) => setSelectedCourse(e.target.value)}
              className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-200"
            >
              <option value="">All Courses</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>

            {/* Provider Filter */}
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-200"
            >
              <option value="">All Providers</option>
              <option value="google_drive">Google Drive</option>
              <option value="onedrive">OneDrive</option>
              <option value="dropbox">Dropbox</option>
              <option value="direct_url">Direct URL</option>
              <option value="other">Other</option>
            </select>

            {/* Category Filter */}
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-200"
            >
              <option value="">All Categories</option>
              <option value="PDF Notes">PDF Notes</option>
              <option value="Lecture Notes">Lecture Notes</option>
              <option value="Assignments">Assignments</option>
              <option value="Question Papers">Question Papers</option>
              <option value="Interview Materials">Interview Materials</option>
              <option value="Presentations">Presentations</option>
              <option value="Practical Exercises">Practical Exercises</option>
              <option value="Reference Documents">Reference Documents</option>
              <option value="Projects">Projects</option>
              <option value="Other Resources">Other Resources</option>
            </select>

            {/* Status Filter */}
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-200"
            >
              <option value="">All Statuses</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        </form>
      </div>

      {/* Resources Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Course Resources ({resources.length})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Manage study links, modules, access modes and publishing status
            </p>
          </div>
        </div>

        {loading ? (
          <div className="py-16 text-center">
            <div className="w-8 h-8 border-3 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-500 font-medium mt-3">Loading study materials...</p>
          </div>
        ) : resources.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
              <FileText className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">No resources found</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              Get started by adding Google Drive notes, OneDrive documents, or direct PDFs to courses.
            </p>
            <button
              type="button"
              onClick={handleCreate}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-brand-600 text-white hover:bg-brand-500"
            >
              <PlusCircle className="w-4 h-4" />
              Add First Resource
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4 text-left">Resource Title</th>
                  <th className="py-3 px-4 text-left">Course / Module</th>
                  <th className="py-3 px-4 text-left">Provider & Format</th>
                  <th className="py-3 px-4 text-left">Access Mode</th>
                  <th className="py-3 px-4 text-left">Publish State</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                {resources.map((res) => {
                  const fileMeta = getFileTypeMeta(res.file_type);
                  return (
                    <tr key={res.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
                      <td className="py-3.5 px-4 max-w-xs">
                        <div className="font-bold text-slate-900 dark:text-white leading-snug">
                          {res.title}
                        </div>
                        {res.display_file_name && (
                          <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500 truncate mt-0.5">
                            {res.display_file_name}
                          </div>
                        )}
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                          Category: <span className="font-semibold">{res.resource_category}</span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          {res.course_title}
                        </div>
                        {res.module_name ? (
                          <div className="text-[11px] font-medium text-brand-600 dark:text-cyan-400 flex items-center gap-1 mt-0.5">
                            <Layers className="w-3 h-3" />
                            <span>{res.module_name}</span>
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-400 dark:text-slate-500 italic mt-0.5">
                            General Materials
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <ProviderBadge provider={res.provider} size="xs" />
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${fileMeta.bg} ${fileMeta.color}`}>
                            {res.file_type}
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5">
                          {res.can_download ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                              <Download className="w-3.5 h-3.5" />
                              Downloadable
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                              <ExternalLink className="w-3.5 h-3.5" />
                              Online View
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                          res.publish_status === 'published'
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                        }`}>
                          {res.publish_status}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setViewingResource(res)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
                            title="Preview Details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <a
                            href={res.resource_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg text-brand-600 dark:text-cyan-400 hover:bg-brand-50 dark:hover:bg-slate-800"
                            title="Open external link"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                          <button
                            type="button"
                            onClick={() => handleEdit(res)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-slate-800"
                            title="Edit"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingResource(res)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-800"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Form Modal */}
      <ResourceFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        resource={editingResource}
        courses={courses}
        onSaved={fetchData}
      />

      {/* Details Preview Modal */}
      <ResourceDetailsModal
        isOpen={Boolean(viewingResource)}
        resource={viewingResource}
        onClose={() => setViewingResource(null)}
      />

      {/* Delete Confirmation Modal */}
      {deletingResource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Delete Resource Link?</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Are you sure you want to delete <strong className="text-slate-800 dark:text-slate-200">{deletingResource.title}</strong>? Students will no longer see or download this material.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingResource(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white"
              >
                Delete Resource
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
