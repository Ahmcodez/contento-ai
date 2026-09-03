// Hand-drawn to match this product's own subject matter (upload trays,
// waveforms, timeline cuts, vertical-frame players) rather than a
// generic icon library — each one is specific to what that pipeline
// stage actually does.

const shared = {
  viewBox: '0 0 28 28',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function UploadIcon(props) {
  return (
    <svg {...shared} {...props}>
      <path d="M6 19v3.5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V19" />
      <path d="M14 16.5V5" />
      <path d="M8.5 9.5 14 4l5.5 5.5" />
    </svg>
  );
}

export function WaveformIcon(props) {
  return (
    <svg {...shared} {...props}>
      <path d="M4 14v0" />
      <path d="M8 9v10" />
      <path d="M12.5 5v18" />
      <path d="M17 9v10" />
      <path d="M21 12v4" />
      <path d="M24.5 14v0" />
    </svg>
  );
}

export function FindQuoteIcon(props) {
  return (
    <svg {...shared} {...props}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M20.5 20.5 25 25" />
      <path d="M9.5 10.5c0-1 .8-1.8 1.8-1.8" />
      <path d="M14.5 10.5c0-1 .8-1.8 1.8-1.8" />
      <path d="M9.5 10.5v2.3c0 .9.7 1.6 1.6 1.6" />
      <path d="M14.5 10.5v2.3c0 .9.7 1.6 1.6 1.6" />
    </svg>
  );
}

export function ClipBladeIcon(props) {
  return (
    <svg {...shared} {...props}>
      <path d="M3 8.5h9" />
      <path d="M3 19.5h9" />
      <path d="M13.5 14h11.5" />
      <path d="M20.5 9 25 14l-4.5 5" />
    </svg>
  );
}

export function VerticalFrameIcon(props) {
  return (
    <svg {...shared} {...props}>
      <rect x="9" y="3" width="10" height="22" rx="2" />
      <path d="M12.3 9.5v9l6.2-4.5-6.2-4.5Z" strokeLinejoin="round" />
    </svg>
  );
}

export function PenNibIcon(props) {
  return (
    <svg {...shared} {...props}>
      <path d="M14 4 6 21l3.5-1.5L21 8 14 4Z" strokeLinejoin="round" />
      <path d="M9.5 19.5 8 24" />
      <path d="M12.5 9.5l6.5 6" />
    </svg>
  );
}
