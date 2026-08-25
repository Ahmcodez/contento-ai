'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import ProjectCard from '@/components/ProjectCard';
import UsageSummaryCard from '@/components/UsageSummaryCard';
import { listProjects } from '@/lib/api/projects';

export default function DashboardPage() {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    setError(null);
    try {
      const res = await listProjects();
      setProjects(res.data);
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-paper">Projects</h1>
          <p className="mt-1 text-sm text-slate">Your uploads and what&apos;s been made from them.</p>
        </div>
        <Link href="/projects/new">
          <Button>New project</Button>
        </Link>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {error && <ErrorState message={error.message} onRetry={load} />}

          {!error && projects === null && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </div>
          )}

          {!error && projects?.length === 0 && (
            <EmptyState
              title="No projects yet"
              description="Create a project and upload a video to get started — Contento will transcribe it, find the best short clips, and write posts from it."
              action={
                <Link href="/projects/new">
                  <Button>Create your first project</Button>
                </Link>
              }
            />
          )}

          {!error && projects && projects.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </div>

        <div>
          <UsageSummaryCard />
        </div>
      </div>
    </div>
  );
}
