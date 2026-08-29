import Link from 'next/link';
import Button from '@/components/ui/Button';

export default function FinalCta() {
  return (
    <section className="border-t border-line-dark">
      <div className="mx-auto max-w-6xl px-6 py-24 text-center">
        <h2 className="font-display text-4xl leading-tight text-paper">
          Your next upload could already be a dozen posts.
        </h2>
        <div className="mt-8">
          <Link href="/signup">
            <Button size="lg">Start free</Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
