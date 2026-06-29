// Brand logo image — replaces the hex motif on welcome / empty states.
interface Props {
  size?: number;
  className?: string;
}

export default function Logo({ size = 96, className }: Props) {
  return (
    <img
      src="/logo.png"
      width={size}
      height={size}
      alt="Open Apiary"
      className={className}
      style={{ objectFit: 'contain' }}
    />
  );
}
