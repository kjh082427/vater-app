import { useEffect, useState } from 'react';
import { Gallery } from './Gallery';
import { ShellPreview } from './ShellPreview';

type View = 'catalog' | 'shell' | 'shell-offline';

function viewFromHash(): View {
  const hash = window.location.hash;
  if (hash === '#shell') return 'shell';
  if (hash === '#shell-offline') return 'shell-offline';
  return 'catalog';
}

/** gallery.html: 기본은 컴포넌트 목록, #shell·#shell-offline은 창 틀 견본. */
export function GalleryApp() {
  const [view, setView] = useState<View>(viewFromHash);
  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  if (view === 'catalog') return <Gallery />;
  return <ShellPreview offline={view === 'shell-offline'} />;
}
