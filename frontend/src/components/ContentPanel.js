'use client';

import { useEffect, useState } from 'react';
import Tabs from '@/components/ui/Tabs';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import ContentEditor from '@/components/ContentEditor';
import { getContent } from '@/lib/api/jobs';

const CONTENT_TABS = [
  { id: 'blog', label: 'Blog' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'x_twitter', label: 'X' },
  { id: 'instagram_caption', label: 'Instagram' },
  { id: 'youtube_description', label: 'YouTube' },
];

export default function ContentPanel({ jobId, jobIsActive }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('blog');

  async function load() {
    setError(null);
    try {
      const data = await getContent(jobId);
      setItems(data);
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  function handleContentChange(updated) {
    setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
  }

  if (error) return <ErrorState message={error.message} onRetry={load} />;

  if (!items) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title={jobIsActive ? 'Writing content…' : 'No content generated'}
        description={
          jobIsActive
            ? 'Blog, LinkedIn, X, Instagram, and YouTube copy show up here once generated.'
            : 'Written content wasn\u2019t generated for this video.'
        }
      />
    );
  }

  const activeContent = items.find((item) => item.contentType === activeTab);

  return (
    <div>
      <Tabs
        tabs={CONTENT_TABS.map((tab) => ({
          ...tab,
          disabled: !items.some((item) => item.contentType === tab.id),
        }))}
        active={activeTab}
        onChange={setActiveTab}
      />
      <div className="mt-5">
        {activeContent ? (
          <ContentEditor jobId={jobId} content={activeContent} onChange={handleContentChange} />
        ) : (
          <p className="py-8 text-center text-sm text-slate">This content type hasn&apos;t been generated.</p>
        )}
      </div>
    </div>
  );
}
