import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// A TAB OPEN ACROSS A DEPLOY (2026-09-23): the deploy removes the old build's
// files, so a lazily loaded piece the old tab asks for afterwards is gone.
// Vite raises this event for exactly that; reloading picks up the new build,
// and the game in progress is saved, so it comes straight back.
window.addEventListener('vite:preloadError', () => { window.location.reload(); });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
