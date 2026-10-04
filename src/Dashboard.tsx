import { useEffect, useRef, useState, type MouseEvent } from 'react';
import WorkspaceIcon from './WorkspaceIcon';
import { DESKS, type WorkspaceView } from './workspace-navigation';

export default function Dashboard({ active, motionEnabled, reducedMotion, onToggleMotion, follow, archiveCount }: { active: boolean; motionEnabled: boolean; reducedMotion: boolean; onToggleMotion: () => void; follow: (event: MouseEvent<HTMLAnchorElement>, view: WorkspaceView) => void; archiveCount: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackUnavailable, setPlaybackUnavailable] = useState(false);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      if (active && motionEnabled && document.visibilityState === 'visible') {
        void video.play().catch(() => { /* Native controls remain available if autoplay is blocked. */ });
      } else video.pause();
    };
    sync(); document.addEventListener('visibilitychange', sync);
    return () => { video.pause(); document.removeEventListener('visibilitychange', sync); };
  }, [active, motionEnabled]);
  return <section className="workspace-dashboard" id="home" aria-labelledby="dashboard-heading">
    <div className="dashboard-heading"><h2 id="dashboard-heading">Your IMD workspace<span>.</span></h2><p>Pick a tool. Keep the thread.</p></div>
    <div className="dashboard-comic">
      <div className="dashboard-art">{playbackUnavailable ? <img src="/brand/kaori-project-film-poster.jpg" alt="Kaori in the project's animated comic" width="1280" height="720" /> : <video ref={videoRef} src="/brand/kaori-project-film.mp4" poster="/brand/kaori-project-film-poster.jpg" muted loop playsInline controls preload="metadata" aria-label="Kaori IMD animated comic, without audio" onError={() => setPlaybackUnavailable(true)} />}</div>
      <div className="dashboard-comic-copy"><h3>Every transfer<br /><span>has a story.</span></h3><div className="dashboard-actions"><a className="workspace-action primary" href="#receipt" onClick={event => follow(event, 'receipt')}>Read a receipt<WorkspaceIcon name="arrow" /></a><a className="workspace-action secondary" href="#network" onClick={event => follow(event, 'network')}>Explore the network<WorkspaceIcon name="arrow" /></a></div><button className="comic-motion-control" type="button" disabled={reducedMotion || playbackUnavailable} onClick={onToggleMotion}><WorkspaceIcon name={motionEnabled ? 'pause' : 'play'} />{reducedMotion ? 'Reduced motion' : playbackUnavailable ? 'Still artwork' : motionEnabled ? 'Pause animation' : 'Play animation'}</button></div>
      <div className="comic-petals" aria-hidden="true"><i /><i /><i /></div>
    </div>
    <nav className="dashboard-tools" aria-label="Choose a utility">{DESKS.filter(desk => desk.id !== 'home').map(desk => <a key={desk.id} className="dashboard-tool" href={`#${desk.id}`} onClick={event => follow(event, desk.id)}><span className="dashboard-tool-icon"><WorkspaceIcon name={desk.icon} /></span><h3>{desk.title}</h3><p>{desk.id === 'archive' && archiveCount > 0 ? `${archiveCount} saved ${archiveCount === 1 ? 'receipt' : 'receipts'} in this browser. Reopen your records and notes.` : desk.description}</p><WorkspaceIcon name="arrow" /></a>)}</nav>
  </section>;
}
