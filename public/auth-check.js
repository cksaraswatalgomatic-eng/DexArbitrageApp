// public/auth-check.js
(function () {
  function parseCookies() {
    return document.cookie.split(';').reduce((acc, part) => {
      const [rawKey, ...rawVal] = part.split('=');
      if (!rawKey) {
        return acc;
      }
      const key = decodeURIComponent(rawKey.trim());
      const value = decodeURIComponent(rawVal.join('=').trim());
      if (key) {
        acc[key] = value;
      }
      return acc;
    }, {});
  }

  const cookies = parseCookies();
  if (cookies.loggedIn !== 'true') {
    window.location.href = '/login.html';
    return;
  }

  const role = cookies.userRole || 'user';
  if (role === 'admin') {
    return;
  }

  const hideAdminElements = () => {
    document.querySelectorAll('[data-requires-role="admin"]').forEach((el) => {
      el.style.display = 'none';
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hideAdminElements, { once: true });
  } else {
    hideAdminElements();
  }
})();