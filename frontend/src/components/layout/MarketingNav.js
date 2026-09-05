import Link from 'next/link';
import Button from '@/components/ui/Button';

export default function MarketingNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-mist bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="font-jakarta text-lg font-bold tracking-tight text-graphite">
          Contento
        </Link>
        <nav className="hidden items-center gap-8 font-jakarta text-sm text-steel md:flex">
          <a href="#how-it-works" className="hover:text-graphite">
            How it works
          </a>
          <a href="#why-us" className="hover:text-graphite">
            Why Contento
          </a>
          <a href="#pricing" className="hover:text-graphite">
            Pricing
          </a>
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/login" className="font-jakarta text-sm text-steel hover:text-graphite">
            Log in
          </Link>
          <Link href="/signup">
            <Button variant="gradientPill" size="sm">
              Start free
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
