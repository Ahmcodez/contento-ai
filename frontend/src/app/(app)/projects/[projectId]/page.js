'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Skeleton from '@/components/ui/Skeleton';
import ErrorState from '@/components/ui/ErrorState';
import EmptyState from '@/components/ui/EmptyState';
import Button from '@/components/ui/Button';
import UploadDropzone from '@/components/upload/UploadDropzone';
import MediaAssetRow from '@/components/MediaAssetRow';
import { getProject } from '@/lib/api/projects';

export default function ProjectOverviewPage() {
  const { projectId } = useParams();
  const router = useRouter();
  const [project, setProject] = useState(null);
  const [error, setError] = useState(null);
  const [showUpload, setShowUpload] = useState(false);

  async function load() {
    setError(null);
    try {
      const data = await getProject(projectId);
      setProject(data);
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function handleUploaded(result) {
    router.push(`/projects/${projectId}/jobs/${result.processingJob.id}`);
  }

  if (error) return <ErrorState title="Couldn't load this project" message={error.message} onRetry={load} />;

  if (!project) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-paper">{project.title}</h1>
          {project.description && <p className="mt-1 max-w-xl text-sm text-slate">{project.description}</p>}
        </div>
        {!showUpload && <Button onClick={() => setShowUpload(true)}>Upload another video</Button>}
      </div>

      {showUpload && (
        <div className="mt-6">
          <UploadDropzone projectId={projectId} onUploaded={handleUploaded} />
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-sm font-medium text-slate">Uploads</h2>
        <div className="mt-3 flex flex-col gap-3">
          {project.mediaAssets.length === 0 ? (
            <EmptyState
              title="No uploads yet"
              description="Upload a video to start the pipeline — transcription, clip detection, and content generation happen automatically."
              action={<Button onClick={() => setShowUpload(true)}>Upload a video</Button>}
            />
          ) : (
            project.mediaAssets.map((asset) => (
              <MediaAssetRow key={asset.id} projectId={projectId} asset={asset} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
