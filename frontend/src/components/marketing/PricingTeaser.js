import Link from 'next/link';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';

const TIERS = [
  {
    name: 'Free',
    price: '$0',
    description: 'For trying it out on a real video.',
    features: ['60-minute max video length', '2 concurrent jobs', '10 clips per video', '50 AI requests / day'],
    cta: 'Start free',
    href: '/signup',
    highlighted: true,
  },
  {
    name: 'Pro',
    price: 'Coming soon',
    description: 'Higher limits for regular publishing.',
    features: ['4-hour max video length', '5 concurrent jobs', '25 clips per video', '500 AI requests / day'],
    cta: 'Get notified',
    href: '/signup',
    highlighted: false,
  },
];

export default function PricingTeaser() {
  return (
    <section id="pricing" className="bg-white px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <h2 className="font-jakarta text-3xl font-bold text-graphite">Pricing</h2>
        <p className="mt-2 max-w-lg text-steel">Start free. Paid plans are not yet available for purchase.</p>

        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {TIERS.map((tier) => (
            <Card
              key={tier.name}
              variant="plain"
              interactive
              className={`rounded-2xl border p-6 ${
                tier.highlighted ? 'border-accent-violet/30 bg-white shadow-lg shadow-accent-violet/10' : 'border-mist bg-white'
              }`}
            >
              <div className="flex items-baseline justify-between">
                <h3 className="font-jakarta text-xl font-semibold text-graphite">{tier.name}</h3>
                <span className="font-mono text-sm text-steel">{tier.price}</span>
              </div>
              <p className="mt-1.5 text-[13px] text-steel">{tier.description}</p>
              <ul className="mt-5 flex flex-col gap-2 text-[13px] text-graphite/90">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <span className="h-1 w-1 shrink-0 rounded-full bg-accent-magenta" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link href={tier.href} className="mt-6 block">
                <Button variant={tier.highlighted ? 'gradientPill' : 'outlinePill'} className="w-full">
                  {tier.cta}
                </Button>
              </Link>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
