// public/auth-check.js
if (!document.cookie.includes('loggedIn=true')) {
  window.location.href = '/login.html';
}
