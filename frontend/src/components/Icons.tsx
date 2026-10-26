import type { SVGProps } from "react";

// One stroke icon set (24px grid, currentColor) so navigation and cards stay consistent.
function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export const HomeIcon = () => <Icon><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /><path d="M10 20v-5h4v5" /></Icon>;
export const WalletIcon = () => <Icon><rect x="3" y="6" width="18" height="14" rx="3" /><path d="M3 10h18" /><path d="M16 15h2" /><path d="M6 6V5a2 2 0 0 1 2-2h9" /></Icon>;
export const SendIcon = () => <Icon><path d="M4 12 20 4l-6 16-3-7-7-1Z" /></Icon>;
export const SwapIcon = () => <Icon><path d="M7 4v14" /><path d="m3 14 4 4 4-4" /><path d="M17 20V6" /><path d="m21 10-4-4-4 4" /></Icon>;
export const ShieldIcon = () => <Icon><path d="M12 3 4.5 6v6c0 4.4 3.1 7.8 7.5 9 4.4-1.2 7.5-4.6 7.5-9V6L12 3Z" /><path d="m9 12 2 2 4-4" /></Icon>;
export const RequestIcon = () => <Icon><path d="M20 12 4 20l6-16 3 7 7 1Z" /></Icon>;
export const SplitIcon = () => <Icon><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17" /><path d="M12 12 18 6" /></Icon>;
export const KeyIcon = () => <Icon><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9" /><path d="m17 6 3 3" /><path d="m15 8 2 2" /></Icon>;
export const LockIcon = () => <Icon><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></Icon>;
export const EyeOffIcon = () => <Icon><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0 1 12 5c5 0 8.5 4.5 9.5 7a14 14 0 0 1-2.8 3.9" /><path d="M6.4 6.4C4.5 7.7 3.1 9.7 2.5 12c1 2.5 4.5 7 9.5 7a9.7 9.7 0 0 0 4.4-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Icon>;
export const PrivacyIcon = () => <Icon><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5a8.5 8.5 0 0 0 0 17" fill="currentColor" stroke="none" opacity=".9" /></Icon>;
export const ArrowRightIcon = () => <Icon><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></Icon>;
