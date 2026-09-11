import clsx from 'clsx';

/* Most shops never upload photos for every item, so an image-less product
   gets a generated tile — its initials on a hue derived from the name.
   Deterministic, so the same dish always looks the same. */

function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function initialsOf(name: string): string {
  const words = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function ProductThumb({
  name, image, className, textClass,
}: { name: string; image?: string; className?: string; textClass?: string }) {
  if (image) {
    return (
      <img
        src={image}
        alt=""
        loading="lazy"
        className={clsx('w-full h-full object-cover', className)}
      />
    );
  }

  const hue = hueOf(name);

  /* The tile is drawn from CSS custom properties so the same element can carry
     a light and a dark palette — a fixed pastel would glare in dark mode. */
  return (
    <div
      className={clsx('product-thumb w-full h-full grid place-items-center select-none', className)}
      style={{ '--thumb-hue': hue } as React.CSSProperties}
      aria-hidden
    >
      <span className={clsx('font-extrabold tracking-tight', textClass ?? 'text-[20px]')}>
        {initialsOf(name)}
      </span>
    </div>
  );
}
