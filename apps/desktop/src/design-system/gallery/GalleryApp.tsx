import { useEffect, useState } from 'react';
import { DashboardPreview } from './DashboardPreview';
import { Gallery } from './Gallery';
import { ShellPreview } from './ShellPreview';

type View = 'catalog' | 'shell' | 'shell-offline' | 'dashboard';

function viewFromHash(): View {
  const hash = window.location.hash;
  if (hash === '#shell') return 'shell';
  if (hash === '#shell-offline') return 'shell-offline';
  if (hash === '#dashboard') return 'dashboard';
  return 'catalog';
}

/** gallery.html: 기본은 컴포넌트 목록, #shell·#shell-offline은 창 틀 견본, #dashboard는 대시보드 견본. */
export function GalleryApp() {
  const [view, setView] = useState<View>(viewFromHash);
  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  if (view === 'catalog') return <Gallery />;
  if (view === 'dashboard') return <DashboardPreview />;
  return <ShellPreview offline={view === 'shell-offline'} />;
}
