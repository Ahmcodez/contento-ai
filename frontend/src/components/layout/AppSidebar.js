'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/AuthContext';

const NAV_LINKS = [
  {
    href: '/dashboard',
    label: 'Projects',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="2.5" y="3.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M2.5 7h13" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
  {
    href: '/usage',
    label: 'Usage',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M3 14.5V9M9 14.5V4M15 14.5v-7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
];

export default function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-mist bg-white">
      <div className="px-5 py-6">
        <Link href="/dashboard" className="font-jakarta text-lg font-bold text-graphite">
          Contento
        </Link>
      </div>

      <div className="px-3">
        <Link href="/projects/new">
          <button className="flex w-full items-center justify-center gap-1.5 rounded-full bg-brand-gradient px-4 py-2.5 text-sm font-medium text-white shadow-pill-glow transition-all hover:brightness-110 active:brightness-95">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            New project
          </button>
        </Link>
      </div>

      <nav className="mt-6 flex flex-col gap-1 px-3">
        {NAV_LINKS.map((link) => {
          const isActive = pathname?.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors
                ${isActive ? 'bg-mist/70 text-graphite' : 'text-steel hover:bg-mist/40 hover:text-graphite'}`}
            >
              {link.icon}
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-mist p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-mist text-[13px] font-medium text-graphite">
            {user?.email?.[0]?.toUpperCase() || '?'}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] text-steel">{user?.email}</span>
        </div>
        <button
          onClick={handleLogout}
          className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-steel transition-colors hover:bg-mist/40 hover:text-graphite"
        >
          Log out
        </button>
      </div>
    </aside>
  );
}
