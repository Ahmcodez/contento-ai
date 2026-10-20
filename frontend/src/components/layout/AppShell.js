'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AppSidebar from '@/components/layout/AppSidebar';

/**
 * The signed-in page frame. At lg and up it is the familiar fixed sidebar plus
 * content. Below lg the sidebar would eat most of the screen (it is 240px wide),
 * so it becomes an off-canvas drawer opened from a slim top bar, and the content
 * gets the whole width.
 */
export default function AppShell({ children }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Navigating (tapping a link in the drawer) closes it.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  return (
    <div className="min-h-screen bg-white lg:flex">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-mist bg-white/90 px-4 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-controls="app-sidebar"
          className="-ml-2 flex h-10 w-10 items-center justify-center rounded-lg text-graphite hover:bg-mist/50"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <Link href="/dashboard" className="font-jakarta text-lg font-bold text-graphite">
          Contento
        </Link>
      </header>

      {menuOpen && (
        <button
          type="button"
          aria-label="Close menu"
          tabIndex={-1}
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-30 bg-graphite/40 lg:hidden"
        />
      )}

      <AppSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
