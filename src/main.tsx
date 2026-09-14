import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { OrientationGuard } from './ui/OrientationGuard';

const root = document.getElementById('app');
if (!root) throw new Error('Falta #app en index.html');

new OrientationGuard(document.body);
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
