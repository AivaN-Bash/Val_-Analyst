import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import ValorantAnalyzer from './ValorantAnalyzer.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ValorantAnalyzer />
  </StrictMode>,
);
