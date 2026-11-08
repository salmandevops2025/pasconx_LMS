import React, { useState, useEffect } from 'react';
import api from '../../api/client.js';
import ResourceCard from '../../components/resources/ResourceCard.jsx';
import { 
  FileText, 
  Search, 
  Filter, 
  BookOpen, 
  Layers, 
  Download, 
  ExternalLink,
  FolderOpen
} from 'lucide-react';

export default function StudentResourcesPage() {
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedCourse, setSelectedCourse] = useState('ALL');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  useEffect(() => {
    let isMounted = true;
    api.get('/student/resources')
      .then((res) => {
        if (isMounted && res.success) {
          setResources(res.resources || []);
        }
      })
      .catch((err) => {
        if (isMounted) setError(err.message || 'Failed to load study materials.');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => { isMounted = false; };
  }, []);

  // Filter courses & categories from student's authorized resources
  const availableCourses = Array.from(
    new Map(resources.map((r) => [r.course_id, { id: r.course_id, title: r.course_title }])).values()
  );

  const availableCategories = Array.from(
    new Set(resources.map((r) => r.resource_category))
  );

  // Filtered resources
  const filteredResources = resources.filter((r) => {
    const matchCourse = selectedCourse === 'ALL' || String(r.course_id) === String(selectedCourse);
    const matchCat = selectedCategory === 'ALL' || r.resource_category === selectedCategory;
    const matchSearch = !search || 
      r.title.toLowerCase().includes(search.toLowerCase()) ||
      (r.description && r.description.toLowerCase().includes(search.toLowerCase())) ||
      (r.module_name && r.module_name.toLowerCase().includes(search.toLowerCase()));

    return matchCourse && matchCat && matchSearch;
  });

  // Group by Course, then by Module
  const groupedData = {};
  filteredResources.forEach((res) => {
    const courseTitle = res.course_title || `Course #${res.course_id}`;
    const moduleName = res.module_name || 'General Course Materials';

    if (!groupedData[courseTitle]) {
      groupedData[courseTitle] = {};
    }
    if (!groupedData[courseTitle][moduleName]) {
      groupedData[courseTitle][moduleName] = [];
    }
    groupedData[courseTitle][moduleName].push(res);
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-200/60 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold mb-2">
          PASCON<span className="text-[#0c8ee7]">X</span> Learning Resources
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          Study Materials & External Resources
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Access course notes, assignments, interview documents, and Google Drive resources for your enrolled courses.
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-2xs space-y-3">
        <div className="flex flex-col md:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by topic, document name, or keywords..."
              className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-xs sm:text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {/* Course Filter */}
            <select
              value={selectedCourse}
              onChange={(e) => setSelectedCourse(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-200"
            >
              <option value="ALL">All Enrolled Courses</option>
              {availableCourses.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>

            {/* Category Filter */}
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-200"
            >
              <option value="ALL">All Categories</option>
              {availableCategories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-20 text-center">
          <div className="w-8 h-8 border-3 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-500 font-medium mt-3">Loading authorized study materials...</p>
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : filteredResources.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
            <FolderOpen className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">No resources available</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
            {search || selectedCourse !== 'ALL' || selectedCategory !== 'ALL'
              ? 'No study materials matched your filters. Try resetting the search filters.'
              : 'Your instructors have not added external study materials for your courses yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-10">
          {Object.entries(groupedData).map(([courseTitle, modulesMap]) => (
            <div key={courseTitle} className="space-y-6">
              {/* Course Group Header */}
              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-200 dark:border-slate-800">
                <BookOpen className="w-5 h-5 text-brand-600 dark:text-cyan-400 shrink-0" />
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  {courseTitle}
                </h2>
              </div>

              {/* Modules Grouping */}
              <div className="space-y-6 pl-0 sm:pl-2">
                {Object.entries(modulesMap).map(([moduleName, items]) => (
                  <div key={moduleName} className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 px-2.5 py-1 rounded-md border border-slate-200/80 dark:border-slate-700/60">
                        {moduleName}
                      </span>
                      <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">
                        ({items.length} {items.length === 1 ? 'item' : 'items'})
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {items.map((resource) => (
                        <ResourceCard key={resource.id} resource={resource} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
