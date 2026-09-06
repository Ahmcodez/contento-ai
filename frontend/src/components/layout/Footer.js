import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="border-t border-mist bg-white">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col justify-between gap-8 md:flex-row">
          <div>
            <p className="font-jakarta text-lg font-bold text-graphite">Contento</p>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-steel">
              Turn one long-form video into ranked clips and grounded written content, automatically.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <span className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-steel">Product</span>
              <a href="#how-it-works" className="text-steel hover:text-graphite">How it works</a>
              <a href="#why-us" className="text-steel hover:text-graphite">Why Contento</a>
              <a href="#pricing" className="text-steel hover:text-graphite">Pricing</a>
            </div>
            <div className="flex flex-col gap-2">
              <span className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-steel">Account</span>
              <Link href="/login" className="text-steel hover:text-graphite">Log in</Link>
              <Link href="/signup" className="text-steel hover:text-graphite">Sign up</Link>
            </div>
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-mist pt-6 text-[12px] text-steel sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Contento. All rights reserved.</span>
        </div>
      </div>
    </footer>
  );
}
