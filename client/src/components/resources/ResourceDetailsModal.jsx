import React from 'react';
import Modal from '../common/Modal.jsx';
import ProviderBadge, { getFileTypeMeta } from './ProviderBadge.jsx';
import { 
  ExternalLink, 
  Download, 
  FileText, 
  BookOpen, 
  Layers, 
  Tag, 
  ShieldCheck, 
  AlertCircle, 
  Info,
  Calendar,
  Lock
} from 'lucide-react';

export default function ResourceDetailsModal({ resource, isOpen, onClose }) {
  if (!resource) return null;

  const fileMeta = getFileTypeMeta(resource.file_type);
  const isGoogleDrive = resource.provider === 'google_drive';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Study Material & Resource Details"
      maxWidth="max-w-2xl"
    >
      <div className="space-y-6 text-sm">
        {/* Header Block */}
        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-start gap-3.5">
          <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-brand-600 dark:text-cyan-400 shrink-0">
            <FileText className="w-6 h-6" />
          </div>
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${fileMeta.bg} ${fileMeta.color}`}>
                {fileMeta.label}
              </span>
              <ProviderBadge provider={resource.provider} size="xs" />
              {resource.publish_status && (
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                  resource.publish_status === 'published' 
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                }`}>
                  {resource.publish_status}
                </span>
              )}
            </div>
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white leading-tight">
              {resource.title}
            </h3>
            {resource.display_file_name && (
              <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
                {resource.display_file_name}
              </p>
            )}
          </div>
        </div>

        {/* Description */}
        {resource.description && (
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Description & Instructions
            </label>
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 whitespace-pre-line text-xs sm:text-sm leading-relaxed">
              {resource.description}
            </div>
          </div>
        )}

        {/* Key Metadata Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 flex items-center gap-3">
            <BookOpen className="w-4 h-4 text-slate-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Course</div>
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                {resource.course_title || `Course #${resource.course_id}`}
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 flex items-center gap-3">
            <Layers className="w-4 h-4 text-slate-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Module / Topic</div>
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                {resource.module_name || 'General Course Materials'}
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 flex items-center gap-3">
            <Tag className="w-4 h-4 text-slate-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Resource Category</div>
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                {resource.resource_category}
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 flex items-center gap-3">
            <ShieldCheck className="w-4 h-4 text-slate-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Access Mode</div>
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                {resource.can_download ? 'Direct Download & View' : 'Online Document View'}
              </div>
            </div>
          </div>
        </div>

        {/* Permission & Access Notice */}
        <div className="p-3.5 rounded-xl bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 text-xs text-blue-900 dark:text-blue-300 space-y-1">
          <div className="flex items-center gap-2 font-bold text-blue-700 dark:text-blue-300">
            <Info className="w-4 h-4 shrink-0" />
            <span>Access & Permission Advisory</span>
          </div>
          <p className="leading-relaxed">
            {resource.permission_notice || (
              isGoogleDrive 
                ? 'Note: Access requires appropriate permissions on the host Google Drive account. If prompted for access, please make sure you are signed in with your authorized email.'
                : 'This is an official PASCONX external resource link. Links open securely in a separate browser tab.'
            )}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            Close
          </button>

          {resource.can_download && resource.download_url && (
            <a
              href={resource.download_url}
              target="_blank"
              rel="noopener noreferrer"
              download={resource.display_file_name || true}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-2xs transition-colors"
            >
              <Download className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Download File</span>
            </a>
          )}

          <a
            href={resource.resource_url}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-brand-600 hover:bg-brand-500 text-white shadow-xs transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            <span>Open Resource in New Tab</span>
          </a>
        </div>
      </div>
    </Modal>
  );
}
