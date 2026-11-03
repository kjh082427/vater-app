import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';

// 디자인 시스템 견본(gallery.html). 컴포넌트가 생기는 대로 여기에 실제 상태로 늘어놓는다.
const root = document.getElementById('root');
if (!root) throw new Error('#root 요소가 없습니다');

createRoot(root).render(
  <StrictMode>
    <main>
      <h1>Vater 디자인 시스템</h1>
    </main>
  </StrictMode>,
);
