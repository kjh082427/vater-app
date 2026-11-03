import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './design-system/styles.css';

// 앱 진입점. 화면(src/screens)과 Tauri 어댑터(src/platform)는 ui/screens 브랜치에서 채운다(스펙 9-3).
const root = document.getElementById('root');
if (!root) throw new Error('#root 요소가 없습니다');

createRoot(root).render(
  <StrictMode>
    <main>
      <h1>Vater</h1>
      <p>화면은 ui/screens 브랜치에서 만듭니다.</p>
    </main>
  </StrictMode>,
);
