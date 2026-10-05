/** Entrée de l'application connectée (/app/*), SPA servie par app.html. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../app/App';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
