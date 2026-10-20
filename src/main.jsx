/**
 * Entry point: mounts `<App />` into the `#root` element of
 * `index.html` inside React's `StrictMode`, and registers the service
 * worker in production builds.
 *
 * In development `StrictMode` deliberately runs effects twice, so
 * duplicate network calls under `npm run dev` are expected and do not
 * happen in a production build.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register the app-shell service worker only in production builds.
// Skipping this in dev avoids any interference with Vite's HMR / dev server.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration failure shouldn't break the app — offline support
      // just won't be available, everything else works as normal.
    });
  });
}