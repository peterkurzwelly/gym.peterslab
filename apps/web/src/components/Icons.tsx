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
