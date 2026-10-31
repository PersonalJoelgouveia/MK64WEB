/* Registra coi-sw.js e recarrega uma vez para ativar o isolamento de origem (crossOriginIsolated). */
(function () {
  if (window.crossOriginIsolated || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('coi-sw.js').then((reg) => {
    const reload = () => { if (!sessionStorage.getItem('mk64-coi')) { sessionStorage.setItem('mk64-coi', '1'); location.reload(); } };
    if (reg.active && !navigator.serviceWorker.controller) reload();
    else reg.addEventListener('updatefound', () => reg.installing && reg.installing.addEventListener('statechange', function () { if (this.state === 'activated') reload(); }));
    navigator.serviceWorker.ready.then(() => { if (!navigator.serviceWorker.controller) reload(); });
  }).catch((e) => console.warn('coi-sw falhou', e));
})();
