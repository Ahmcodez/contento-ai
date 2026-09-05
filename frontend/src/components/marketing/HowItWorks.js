'use client';

import { motion, useReducedMotion } from 'framer-motion';
import Card from '@/components/ui/Card';
import {
  UploadIcon,
  WaveformIcon,
  FindQuoteIcon,
  ClipBladeIcon,
  VerticalFrameIcon,
  PenNibIcon,
} from './PipelineIcons';

const STAGES = [
  {
    label: 'Upload',
    description: 'Drop in your long-form video — a podcast episode, talk, interview, or stream.',
    Icon: UploadIcon,
    // TODO: set to a real photo path once provided (e.g. someone uploading
    // a file) — the card already renders it with a legibility overlay,
    // see the backgroundImage handling below.
    image: null,
  },
  {
    label: 'Transcribe',
    description: 'Full timestamped transcript, down to the segment.',
    Icon: WaveformIcon,
    image: null,
  },
  {
    label: 'Analyze',
    description: 'Topics, stories, strong opinions, and quotable moments — identified, not guessed.',
    Icon: FindQuoteIcon,
    image: null,
  },
  {
    label: 'Find clips',
    description: 'Candidate moments scored on hook strength, clarity, and whether they stand alone.',
    Icon: ClipBladeIcon,
    image: null,
  },
  {
    label: 'Render',
    description: 'Vertical 9:16 clips with burned-in captions and a thumbnail, ready to post.',
    Icon: VerticalFrameIcon,
    image: null,
  },
  {
    label: 'Write',
    description: 'Blog post, LinkedIn, X, Instagram caption, and YouTube description — grounded in the transcript.',
    Icon: PenNibIcon,
    image: null,
  },
];

function StageCard({ stage, index }) {
  const prefersReducedMotion = useReducedMotion();
  const fromLeft = index % 2 === 0;

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, x: fromLeft ? -36 : 36 }}
      whileInView={{ opacity: 1, x: 0 }}
      // once: false + this margin means the card replays its entrance
      // every time it crosses into view — scrolling back up re-triggers it
      // just like scrolling down does — rather than only ever once.
      viewport={{ once: false, amount: 0.4, margin: '-40px' }}
      transition={{ duration: 0.9, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
    >
      <Card
        interactive
        className="group relative flex h-full min-h-[280px] flex-col overflow-hidden p-6"
        style={
          stage.image
            ? { backgroundImage: `url('${stage.image}')`, backgroundSize: 'cover', backgroundPosition: 'center' }
            : undefined
        }
      >
        {stage.image && (
          <div
            className="absolute inset-0 bg-gradient-to-t from-surface-dark via-surface-dark/75 to-surface-dark/20"
            aria-hidden="true"
          />
        )}
        <div className="relative flex items-start justify-between">
          <stage.Icon className="h-8 w-8 text-paper transition-colors duration-200 group-hover:text-tally" />
          <span className="font-mono text-[12px] tabular text-slate-dim">{String(index + 1).padStart(2, '0')}</span>
        </div>
        <h3 className="relative mt-5 font-display text-lg text-paper">{stage.label}</h3>
        <p className="relative mt-1.5 text-[13px] leading-relaxed text-slate">{stage.description}</p>
      </Card>
    </motion.div>
  );
}

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="border-t border-line-dark">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="font-display text-3xl text-paper">How it works</h2>
        <p className="mt-2 max-w-lg text-slate">
          One upload runs through a real pipeline — every stage produces something you can inspect.
        </p>

        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {STAGES.map((stage, i) => (
            <StageCard key={stage.label} stage={stage} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
