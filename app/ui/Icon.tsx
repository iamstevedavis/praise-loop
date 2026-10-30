const paths = {
  loop: <><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v4h-4" /></>,
  week: <><path d="M4 13h4l1.5 3h5L16 13h4" /><path d="M5 5h14l1 8v6H4v-6z" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  reviews: <path d="M4 5h16v11H9l-5 4z" />,
  palette: <><circle cx="12" cy="12" r="9" /><circle cx="8" cy="10" r="1.2" /><circle cx="12" cy="7.5" r="1.2" /><circle cx="16" cy="10" r="1.2" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 6.3" /><path d="M20 5v6h-6" /></>,
  archive: <><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10h14V9M10 13h4" /></>,
  plug: <path d="M9 7V3M15 7V3M6 7h12v4a6 6 0 0 1-12 0zM12 17v4" />,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v4h16v-4" /></>,
  alert: <><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17h.01" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>
};

export type IconName = keyof typeof paths;

export default function Icon({ name, size = 20, strokeWidth = 2 }: { name: IconName; size?: number; strokeWidth?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}
