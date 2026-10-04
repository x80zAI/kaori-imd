import type { ReactNode } from 'react';
export type WorkspaceIconName = 'home' | 'receipt' | 'shield' | 'staking' | 'network' | 'archive' | 'info' | 'x' | 'code' | 'external' | 'arrow' | 'copy' | 'check' | 'pause' | 'play' | 'ethereum';
const paths: Record<WorkspaceIconName, ReactNode> = {
  home: <path d="M3 11 12 3l9 8M5 10v11h5v-7h4v7h5V10" />,
  receipt: <path d="M5 3h10l4 4v14H5ZM15 3v5h4M8 11h8M8 15h8M8 18h4" />,
  shield: <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6ZM8 12l3 3 5-6" />,
  staking: <path d="m12 2 5 3v6l-5 3-5-3V5ZM7 11l-5 3v6l5 3 5-3v-6l5-3 5 3v6l-5 3-5-3M7 5l5 3 5-3M12 8v6M2 14l5 3 5-3 5 3 5-3M7 17v6M17 17v6" />,
  network: <><circle cx="12" cy="4" r="2.5" /><circle cx="4" cy="19" r="2.5" /><circle cx="20" cy="19" r="2.5" /><path d="m10.7 6.2-5.4 10.6M13.3 6.2l5.4 10.6M6.5 19h11" /></>,
  archive: <path d="M3 4h18v5H3ZM5 9v12h14V9M9 13h6" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7v1" /></>,
  x: <path d="m4 3 16 18h-4L4 7V3Zm16 0-6.6 7.5M4 21l6.6-7.5" />,
  code: <path d="m7 6-5 6 5 6M17 6l5 6-5 6M14 3l-4 18" />,
  external: <path d="M7 17 18 6M7 6h11v11" />,
  arrow: <path d="M3 12h18M15 6l6 6-6 6" />,
  copy: <><path d="M8 8h12v13H8Z" /><path d="M16 8V3H3v13h5" /></>,
  check: <path d="m4 12 5 5L20 6" />,
  pause: <path d="M8 5v14M16 5v14" />,
  play: <path d="m7 4 13 8-13 8Z" />,
  ethereum: <path d="m12 2 7 10-7 4-7-4ZM5 15l7 7 7-7M12 2v14M5 12l7-3 7 3" />,
};
export default function WorkspaceIcon({ name }: { name: WorkspaceIconName }) {
  return <svg className="workspace-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">{paths[name]}</svg>;
}
