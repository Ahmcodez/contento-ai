'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth/AuthContext';

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/usage', label: 'Usage' },
];

export default function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <header className="sticky top-0 z-30 border-b border-line-dark bg-ink/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Link href="/dashboard" className="font-display text-base tracking-tight text-paper">
            Contento
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            {NAV_LINKS.map((link) => {
              const isActive = pathname?.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={isActive ? 'text-paper' : 'text-slate hover:text-paper'}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-line-dark text-[13px] font-medium text-paper hover:border-slate"
          >
            {user?.email?.[0]?.toUpperCase() || '?'}
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-10 w-48 rounded-[4px] border border-line-dark bg-surface-darkRaised py-1 shadow-lg">
              <div className="border-b border-line-dark px-3 py-2 text-[12px] text-slate">{user?.email}</div>
              <button
                onClick={handleLogout}
                className="block w-full px-3 py-2 text-left text-sm text-paper hover:bg-white/5"
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
