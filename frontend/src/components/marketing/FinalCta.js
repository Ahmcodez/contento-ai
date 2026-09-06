import Link from 'next/link';
import Button from '@/components/ui/Button';

export default function FinalCta() {
  return (
    <section className="bg-ice-hero px-6 py-24 text-center">
      <div className="mx-auto max-w-3xl">
        <h2 className="font-jakarta text-4xl font-extrabold leading-tight tracking-tight text-graphite">
          Your next upload could already be <span className="text-gradient-brand">a dozen posts</span>.
        </h2>
        <div className="mt-8">
          <Link href="/signup">
            <Button variant="gradientPill" size="lg">
              Try for free
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
