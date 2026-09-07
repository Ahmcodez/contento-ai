export default function Skeleton({ className = '', ...props }) {
  return <div className={`animate-pulse rounded-[3px] bg-mist ${className}`} {...props} />;
}
