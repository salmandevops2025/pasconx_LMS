import React from 'react';
import { HardDrive, Cloud, Box, Globe, Link2, FileText } from 'lucide-react';

export function getProviderMeta(provider) {
  switch (provider?.toLowerCase()) {
    case 'google_drive':
      return {
        label: 'Google Drive',
        icon: HardDrive,
        badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
        dotColor: 'bg-amber-500'
      };
    case 'onedrive':
      return {
        label: 'OneDrive',
        icon: Cloud,
        badgeClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
        dotColor: 'bg-blue-500'
      };
    case 'dropbox':
      return {
        label: 'Dropbox',
        icon: Box,
        badgeClass: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
        dotColor: 'bg-indigo-500'
      };
    case 'direct_url':
      return {
        label: 'Direct File',
        icon: Globe,
        badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
        dotColor: 'bg-emerald-500'
      };
    default:
      return {
        label: 'External Link',
        icon: Link2,
        badgeClass: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20',
        dotColor: 'bg-slate-400'
      };
  }
}

export function getFileTypeMeta(fileType) {
  const type = (fileType || 'PDF').toUpperCase();
  switch (type) {
    case 'PDF':
      return { label: 'PDF Document', color: 'text-rose-500 dark:text-rose-400', bg: 'bg-rose-500/10 border-rose-500/20' };
    case 'DOC':
    case 'DOCX':
      return { label: 'Word Document', color: 'text-blue-500 dark:text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' };
    case 'XLS':
    case 'XLSX':
      return { label: 'Excel Spreadsheet', color: 'text-emerald-500 dark:text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' };
    case 'PPT':
    case 'PPTX':
      return { label: 'PowerPoint Presentation', color: 'text-amber-500 dark:text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' };
    case 'ZIP':
      return { label: 'ZIP Archive', color: 'text-purple-500 dark:text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20' };
    case 'LINK':
      return { label: 'Web Link', color: 'text-cyan-500 dark:text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20' };
    default:
      return { label: type, color: 'text-slate-500 dark:text-slate-400', bg: 'bg-slate-500/10 border-slate-500/20' };
  }
}

export default function ProviderBadge({ provider, showIcon = true, size = 'sm' }) {
  const meta = getProviderMeta(provider);
  const Icon = meta.icon;

  const sizeClasses = size === 'xs' 
    ? 'text-[10px] px-1.5 py-0.5' 
    : 'text-xs px-2.5 py-1';

  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold rounded-md border ${meta.badgeClass} ${sizeClasses}`}>
      {showIcon && <Icon className="w-3.5 h-3.5" />}
      <span>{meta.label}</span>
    </span>
  );
}
