(function () {
  function logout() {
    fetch('/logout', { method: 'POST', credentials: 'same-origin' })
      .then(() => {
        // Redirect to login; auth-check will handle blocking if cookies linger
        window.location.href = '/login.html';
      })
      .catch((err) => {
        console.error('Logout failed', err);
        window.location.href = '/login.html';
      });
  }

  const bind = () => {
    document.querySelectorAll('[data-action="logout"]').forEach((el) => {
      if (el.dataset.bound === '1') return;
      el.addEventListener('click', (event) => {
        event.preventDefault();
        logout();
      });
      el.dataset.bound = '1';
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();