import type { ReactNode } from 'react';

type ToolHeadingProps = {
  id: string;
  title: string;
  subtitle: string;
  bubble: string;
  children?: ReactNode;
};

export default function ToolHeading({ id, title, subtitle, bubble, children }: ToolHeadingProps) {
  return <header className="tool-heading">
    <div className="tool-heading-copy">
      <h2 id={id} tabIndex={-1}>{title}<span aria-hidden="true">.</span></h2>
      <p>{subtitle}</p>
      {children && <div className="tool-heading-actions">{children}</div>}
    </div>
    <div className="tool-heading-art" aria-hidden="true">
      <img src="/brand/kaori-scene.png" alt="" width="1536" height="1024" />
      <span className="tool-comic-bubble">{bubble}</span>
      <span className="tool-art-pixels" />
    </div>
  </header>;
}
