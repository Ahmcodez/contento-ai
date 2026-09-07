'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AuthProvider, useAuth } from '@/lib/auth/AuthContext';
import AppSidebar from '@/components/layout/AppSidebar';

function Gate({ children }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace('/login');
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div
          role="status"
          className="h-5 w-5 animate-spin rounded-full border-[1.5px] border-steel border-t-transparent"
        >
          <span className="sr-only">Loading…</span>
        </div>
      </div>
    );
  }

  if (status === 'anonymous') {
    return null; // redirect is in flight
  }

  return (
    <div className="flex min-h-screen bg-white">
      <AppSidebar />
      <main className="min-w-0 flex-1 overflow-y-auto px-8 py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}

export default function AppLayout({ children }) {
  return (
    <AuthProvider>
      <Gate>{children}</Gate>
    </AuthProvider>
  );
}
