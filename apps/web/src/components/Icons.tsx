/** Hairline icons (1.5 stroke) drawn for this app. Decorative by default: pass aria-label to expose one. */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={rest["aria-label"] ? undefined : true}
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const MinusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
);

export const GearIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.75v2.5M12 18.75v2.5M21.25 12h-2.5M5.25 12h-2.5M18.54 5.46l-1.77 1.77M7.23 16.77l-1.77 1.77M18.54 18.54l-1.77-1.77M7.23 7.23L5.46 5.46" />
    <circle cx="12" cy="12" r="6.5" />
  </Svg>
);

export const SwapIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 7h12l-3-3M17 17H5l3 3" />
  </Svg>
);

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 5.5v13l10-6.5z" />
  </Svg>
);

export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5.5v13M15 5.5v13" />
  </Svg>
);

export const InfoIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8h.01" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const ChevronIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);

/** Tab: Today. A sun on the horizon line, drawing style. */
export const TodayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 17h18" />
    <path d="M7.5 17a4.5 4.5 0 019 0" />
    <path d="M12 7.5v2M6.2 10.2l1.4 1.4M17.8 10.2l-1.4 1.4" />
  </Svg>
);

/** Tab: Plan. A 12 week sheet. */
export const PlanIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.75" y="4.75" width="16.5" height="14.5" rx="1" />
    <path d="M3.75 9.5h16.5M9.25 9.5v9.75M14.75 9.5v9.75M3.75 14.25h16.5" />
  </Svg>
);

/** Tab: Progress. A rising line on a baseline. */
export const ProgressIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.75 19.25h16.5" />
    <path d="M5 15.5l4.5-4.5 3.5 3 6-6.5" />
    <path d="M15.5 7.5H19v3.5" />
  </Svg>
);

export const BackIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 6l-6 6 6 6" />
  </Svg>
);

/** Tab: Program. A dumbbell. */
export const DumbbellIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 7.5v9M3.75 9.75v4.5M17.5 7.5v9M20.25 9.75v4.5M6.5 12h11" />
  </Svg>
);

/** Tab: You. */
export const UserIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 19.5c1.2-3.2 3.8-4.75 7-4.75s5.8 1.55 7 4.75" />
  </Svg>
);

/** Tab: Today. A bolt. */
export const BoltIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 3.5L5.5 13.5H11l-1 7 7.5-10H12l1-7z" />
  </Svg>
);

export const FlameIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20.5c3.6 0 6-2.5 6-5.9 0-2.6-1.5-4.4-2.9-6.1-.5 1.3-1.2 2-2.1 2.4.3-2.8-.8-5.3-3.2-7.4.2 2.7-1 4.4-2.2 6.1C6.700 11 6 12.500 6 14.600c0 3.400 2.400 5.900 6 5.900z" />
  </Svg>
);

export const StepsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.5 4.5c1.500 0 2.500 1.600 2.500 3.800 0 1.700-.5 2.700-.5 4.200H6c0-1.500-1-2.500-1-4.200 0-2.200 1-3.800 2.500-3.800zM6 14.500h3.500c0 1.700-.6 2.700-1.750 2.700S6 16.200 6 14.500zM16.500 8c1.500 0 2.500 1.600 2.500 3.800 0 1.700-1 2.700-1 4.200h-3.500c0-1.500-.5-2.500-.5-4.200C14 9.600 15 8 16.500 8zM14.500 18H18c0 1.700-.6 2.700-1.750 2.700S14.500 19.700 14.500 18z" />
  </Svg>
);

export const ScaleIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="3.5" />
    <path d="M8.500 8.750a5 5 0 017 0M12 8.500l1.250 2.500" />
  </Svg>
);

export const VideoIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.250" y="5.500" width="17.500" height="13" rx="3" />
    <path d="M10.250 9.250v5.500l4.750-2.750-4.750-2.750z" fill="currentColor" stroke="none" />
  </Svg>
);

export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.250" />
    <path d="M12 7.500V12l3 2" />
  </Svg>
);

export const HeartIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 19.500s-7-4.300-7-9.300A3.900 3.900 0 0112 8a3.900 3.900 0 017 2.200c0 5-7 9.300-7 9.300z" />
  </Svg>
);

export const MoreIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5.500" cy="12" r="1.250" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.250" fill="currentColor" stroke="none" />
    <circle cx="18.500" cy="12" r="1.250" fill="currentColor" stroke="none" />
  </Svg>
);
