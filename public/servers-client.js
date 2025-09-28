function getCookie(name){ const m = document.cookie.match('(?:^|; )'+name.replace(/([.$?*|{}()\[\]\\\/\+^])/g,'\\$1')+'=([^;]*)'); return m? decodeURIComponent(m[1]) : undefined; }
function setCookie(name, value){ const d=new Date(); d.setFullYear(d.getFullYear()+1); document.cookie = `${name}=${encodeURIComponent(value)}; path=/; expires=${d.toUTCString()}`; }
function applyThemeFromCookie(){ const th=getCookie('theme'); const root=document.documentElement; if (th==='light'){ root.classList.add('theme-light'); } else { root.classList.remove('theme-light'); } }

async function initServerSelector() {
  applyThemeFromCookie();
  const sel = document.getElementById('serverSelect');
  if (!sel) return;
  try {
    const cfg = await (await fetch('/servers')).json();
    sel.innerHTML = '';
    for (const s of cfg.servers) {
      const opt = document.createElement('option'); opt.value = s.id; opt.textContent = `${s.label} (${s.baseUrl})`; sel.appendChild(opt);
    }
    sel.value = cfg.activeId;
    sel.addEventListener('change', async () => {
      await fetch(`/servers/${encodeURIComponent(sel.value)}/select`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      location.reload();
    });
  } catch (e) {
    console.error('Failed to load servers:', e);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initServerSelector); else initServerSelector();

// Expose simple theme API for settings pages
window.__theme = {
  set(th){ setCookie('theme', th); applyThemeFromCookie(); },
  get(){ return getCookie('theme')||'dark'; }
};
