import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import TimelineRuler from '@/components/ui/TimelineRuler';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="font-display text-4xl">Contento</h1>
      <Badge tone="active" dot>
        Building
      </Badge>
      <Card className="w-full max-w-md p-6">
        <p className="text-sm text-slate">UI kit smoke test</p>
        <div className="mt-4">
          <TimelineRuler marks={8} />
        </div>
        <Button className="mt-4">Primary action</Button>
      </Card>
    </main>
  );
}
