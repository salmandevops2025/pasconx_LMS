import React, { useState } from 'react';
import ProviderBadge, { getFileTypeMeta } from './ProviderBadge.jsx';
import ResourceDetailsModal from './ResourceDetailsModal.jsx';
import { 
  ExternalLink, 
  Download, 
  Eye, 
  FileText, 
  Layers, 
  MoreVertical, 
  Edit3, 
  Trash2,
  CheckCircle2,
  XCircle
} from 'lucide-react';

export default function ResourceCard({
  resource,
  isAdmin = false,
  onEdit,
  onDelete,
  onToggleStatus
}) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const fileMeta = getFileTypeMeta(resource.file_type);

  return (
    <>
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-2xs hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700 transition-all flex flex-col justify-between group">
        <div className="space-y-3">
          {/* Top Bar: Provider, File Type & Category */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${fileMeta.bg} ${fileMeta.color}`}>
                {fileMeta.label}
              </span>
              <ProviderBadge provider={resource.provider} size="xs" />
            </div>

            {/* Category / Admin Status */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md border border-slate-200/60 dark:border-slate-700/60">
                {resource.resource_category}
              </span>

              {isAdmin && (
                <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                  resource.publish_status === 'published'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                }`}>
                  {resource.publish_status}
                </span>
              )}
            </div>
          </div>

          {/* Module / Topic Indicator */}
          {resource.module_name && (
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-700 dark:text-cyan-400">
              <Layers className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{resource.module_name}</span>
            </div>
          )}

          {/* Title & Description */}
          <div>
            <h4 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white leading-snug group-hover:text-brand-600 dark:group-hover:text-cyan-400 transition-colors">
              {resource.title}
            </h4>
            {resource.description && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                {resource.description}
              </p>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="mt-4 pt-3.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2">
          {/* Details Button */}
          <button
            type="button"
            onClick={() => setIsDetailsOpen(true)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Details</span>
          </button>

          {/* Main Action Buttons */}
          <div className="flex items-center gap-2">
            {/* Download Button (Only if supported) */}
            {resource.can_download && resource.download_url && (
              <a
                href={resource.download_url}
                target="_blank"
                rel="noopener noreferrer"
                download={resource.display_file_name || true}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                title="Download directly"
              >
                <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="hidden sm:inline">Download</span>
              </a>
            )}

            {/* Open Resource Button */}
            <a
              href={resource.resource_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-600 hover:bg-brand-500 text-white shadow-2xs transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Open</span>
            </a>

            {/* Admin Controls */}
            {isAdmin && (
              <div className="flex items-center gap-1 pl-1 border-l border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => onEdit && onEdit(resource)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-slate-800 transition-colors"
                  title="Edit resource"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete && onDelete(resource)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-800 transition-colors"
                  title="Delete resource"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <ResourceDetailsModal
        resource={resource}
        isOpen={isDetailsOpen}
        onClose={() => setIsDetailsOpen(false)}
      />
    </>
  );
}
