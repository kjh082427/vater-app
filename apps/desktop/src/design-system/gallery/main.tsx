import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import { GalleryApp } from './GalleryApp';

// 디자인 시스템 견본(gallery.html). npm run dev 후 http://localhost:5173/gallery.html
const root = document.getElementById('root');
if (!root) throw new Error('#root 요소가 없습니다');

createRoot(root).render(
  <StrictMode>
    <GalleryApp />
  </StrictMode>,
);
