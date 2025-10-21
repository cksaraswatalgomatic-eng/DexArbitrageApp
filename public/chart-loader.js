(function attachChartLoader() {
  if (typeof window.waitForChart === 'function') {
    return;
  }

  const CHART_SRC = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
  const ZOOM_SRC = 'https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js';
  const ADAPTER_SRC = 'https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3';

  const loadScript = (src) => {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === 'true') {
          resolve();
          return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = false; // Preserve execution order for dependencies
      script.dataset.loaded = 'false';
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      document.head.appendChild(script);
    });
  };

  const chartPromise = (async () => {
    if (!window.Chart) {
      await loadScript(CHART_SRC);
    }

    await loadScript(ZOOM_SRC);
    const zoomGlobal = window.ChartZoom ||
      (window['chartjs-plugin-zoom'] && (window['chartjs-plugin-zoom'].default || window['chartjs-plugin-zoom']));
    if (zoomGlobal && !window.ChartZoom) {
      window.ChartZoom = zoomGlobal;
    }

    await loadScript(ADAPTER_SRC);

    if (window.Chart && window.ChartZoom && !window.__chartZoomRegistered) {
      window.Chart.register(window.ChartZoom);
      window.__chartZoomRegistered = true;
    }

    return window.Chart;
  })().catch((err) => {
    console.error('Failed to load Chart.js assets', err);
    throw err;
  });

  window.waitForChart = () => chartPromise;
})();
