import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import type { WorkspaceIconName } from './WorkspaceIcon';

export type WorkspaceView = 'home' | 'receipt' | 'approvals' | 'staking' | 'network' | 'archive' | 'story';
export const DESKS: { id: WorkspaceView; navLabel: string; title: string; icon: WorkspaceIconName; description: string }[] = [
  { id: 'home', navLabel: 'Dashboard', title: 'Dashboard', icon: 'home', description: '' },
  { id: 'receipt', navLabel: 'Receipts', title: 'Receipt desk', icon: 'receipt', description: 'Read an IMD transfer from its transaction hash.' },
  { id: 'approvals', navLabel: 'Approval check', title: 'Approval check', icon: 'shield', description: "See an application's IMD spending permission." },
  { id: 'staking', navLabel: 'Staking', title: 'IMD staking', icon: 'staking', description: 'Deposit and withdraw through the official vault.' },
  { id: 'network', navLabel: 'Network', title: 'Network desk', icon: 'network', description: 'Follow agents, jobs and oracle answers.' },
  { id: 'archive', navLabel: 'My archive', title: 'My archive', icon: 'archive', description: 'Reopen your saved receipts and notes.' },
];
const VIEWS = new Set<string>([...DESKS.map(desk => desk.id), 'story']);
export function currentWorkspaceView(): WorkspaceView {
  const hash = location.hash.slice(1);
  if (VIEWS.has(hash)) return hash as WorkspaceView;
  return new URLSearchParams(location.search).has('tx') ? 'receipt' : 'home';
}

export function useWorkspaceNavigation() {
  const [state, setState] = useState(() => {
    const active = currentWorkspaceView();
    return { active, visited: new Set<WorkspaceView>([active]) };
  });
  const previousView = useRef(state.active);
  const select = useCallback((active: WorkspaceView) => {
    setState(previous => previous.active === active ? previous : { active, visited: new Set([...previous.visited, active]) });
  }, []);
  useEffect(() => {
    const sync = () => select(currentWorkspaceView());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, [select]);
  useEffect(() => {
    if (previousView.current === state.active) return;
    previousView.current = state.active;
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'instant' });
      document.getElementById('workspace-title')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [state.active]);
  const navigate = useCallback((view: WorkspaceView) => {
    const url = new URL(location.href);
    if (url.hash !== `#${view}`) { url.hash = view; history.pushState(null, '', url); }
    select(view);
  }, [select]);
  function follow(event: MouseEvent<HTMLAnchorElement>, view: WorkspaceView) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigate(view);
  }
  return { ...state, navigate, follow };
}
