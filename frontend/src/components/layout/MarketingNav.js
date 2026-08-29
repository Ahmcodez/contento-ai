import Link from 'next/link';
import Button from '@/components/ui/Button';

export default function MarketingNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-line-dark bg-ink/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="font-display text-lg tracking-tight text-paper">
          Contento
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-slate md:flex">
          <a href="#how-it-works" className="hover:text-paper">
            How it works
          </a>
          <a href="#pricing" className="hover:text-paper">
            Pricing
          </a>
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm text-slate hover:text-paper">
            Log in
          </Link>
          <Link href="/signup">
            <Button size="sm">Start free</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
