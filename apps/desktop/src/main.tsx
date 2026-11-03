import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createServices, ServicesProvider, startServices } from './api/services';
import { App } from './app/App';
import './design-system/styles.css';
import { detectPlatform } from './platform';

// 앱 진입점: Tauri 창이면 셸(get_sidecar_info), Vite 개발 서버면 VITE_SIDECAR_URL·VITE_SIDECAR_TOKEN.
const root = document.getElementById('root');
if (!root) throw new Error('#root 요소가 없습니다');

const services = createServices(detectPlatform());
startServices(services);

createRoot(root).render(
  <StrictMode>
    <ServicesProvider services={services}>
      <App />
    </ServicesProvider>
  </StrictMode>,
);
