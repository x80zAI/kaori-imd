import { useEffect, useRef, useState, type MouseEvent } from 'react';
import WorkspaceIcon from './WorkspaceIcon';
import { DESKS, type WorkspaceView } from './workspace-navigation';
import { CHINESE_DESKS } from './workspace-labels';
import { useLanguage } from './i18n';

export default function Dashboard({ active, follow, archiveCount }: { active: boolean; follow: (event: MouseEvent<HTMLAnchorElement>, view: WorkspaceView) => void; archiveCount: number }) {
  const { t, language } = useLanguage();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackUnavailable, setPlaybackUnavailable] = useState(false);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const resume = () => {
      if (active && document.visibilityState === 'visible') {
        void video.play().catch(() => { /* Retry on return or the next visitor interaction if autoplay is blocked. */ });
      }
    };
    resume();
    document.addEventListener('visibilitychange', resume);
    document.addEventListener('pointerdown', resume);
    document.addEventListener('keydown', resume);
    return () => {
      document.removeEventListener('visibilitychange', resume);
      document.removeEventListener('pointerdown', resume);
      document.removeEventListener('keydown', resume);
    };
  }, [active]);
  return <section className="workspace-dashboard" id="home" aria-labelledby="dashboard-heading">
    <div className="dashboard-heading"><h2 id="dashboard-heading">{t('Your IMD workspace', '你的 IMD 工作台')}<span>.</span></h2><p>{t('Pick a tool. Keep the thread.', '选一款工具，让故事延续。')}</p></div>
    <div className="dashboard-comic">
      <div className="dashboard-art">{playbackUnavailable ? <img src="/brand/kaori-project-film-poster.jpg" alt={t("Kaori in the project's animated comic", 'Kaori 的动态漫画')} width="1280" height="720" /> : <video ref={videoRef} src="/brand/kaori-project-film.mp4" poster="/brand/kaori-project-film-poster.jpg" muted loop autoPlay playsInline disablePictureInPicture preload="auto" aria-label={t('Kaori IMD animated comic, without audio', 'Kaori IMD 无声动态漫画')} onError={() => setPlaybackUnavailable(true)} />}</div>
      <div className="dashboard-comic-copy">
        <div className="dashboard-headline">
          <h3 lang={language === 'zh' ? 'zh-CN' : 'en'}><span>{t('Every', '每笔')}</span><span>{t('transfer', '转账')}</span><span className="headline-story">{t('has a story.', '都有故事。')}</span></h3>
          <span className="headline-hanzi" lang="zh-CN" aria-label={t('Story', '故事')}>故事</span>
        </div>
        <div className="dashboard-actions"><a className="workspace-action primary" href="#receipt" onClick={event => follow(event, 'receipt')}>{t('Read a receipt', '读取交易凭证')}<WorkspaceIcon name="arrow" /></a><a className="workspace-action secondary" href="#network" onClick={event => follow(event, 'network')}>{t('Explore the network', '探索网络')}<WorkspaceIcon name="arrow" /></a></div>
      </div>
      <div className="comic-petals" aria-hidden="true"><i /><i /><i /></div>
    </div>
    <nav className="dashboard-tools" aria-label={t('Choose a utility', '选择工具')}>{DESKS.filter(desk => desk.id !== 'home').map(desk => <a key={desk.id} className="dashboard-tool" href={`#${desk.id}`} onClick={event => follow(event, desk.id)}><span className="dashboard-tool-icon"><WorkspaceIcon name={desk.icon} /></span><h3>{t(desk.title, CHINESE_DESKS[desk.id as keyof typeof CHINESE_DESKS].title)}</h3><p>{desk.id === 'archive' && archiveCount > 0 ? t(`${archiveCount} saved ${archiveCount === 1 ? 'receipt' : 'receipts'} in this browser. Reopen your records and notes.`, `当前浏览器已保存 ${archiveCount} 份交易凭证。重新查看你的记录和笔记。`) : t(desk.description, CHINESE_DESKS[desk.id as keyof typeof CHINESE_DESKS].description)}</p><WorkspaceIcon name="arrow" /></a>)}</nav>
    <section className="dashboard-research" aria-labelledby="research-heading">
      <span className="research-stamp">{t('RESEARCH / 001', '研究 / 001')}</span>
      <div><h3 id="research-heading">{t('The ideas behind Kaori.', 'Kaori 背后的理念。')}</h3><p>{t('Our utilities, the problems they address, and the funding model proposed for Kaori Fuel. Read the complete technical research article.', '了解我们的工具、它们解决的问题，以及 Kaori Fuel 提出的资金模型。阅读完整的技术研究文章。')}</p></div>
      <a className="workspace-action secondary" href="/research/kaori">{t('Read the paper', '阅读文章')}<WorkspaceIcon name="arrow" /></a>
    </section>
  </section>;
}
