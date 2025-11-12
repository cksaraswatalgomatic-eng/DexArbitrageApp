document.addEventListener('DOMContentLoaded', () => {
  console.log('DOMContentLoaded event fired in login.js');
  const loginForm = document.getElementById('loginForm');
  const errorMessage = document.getElementById('errorMessage');

  if (loginForm) {
    console.log('loginForm element found.');
    loginForm.addEventListener('submit', async (event) => {
      console.log('Login form submitted.');
      event.preventDefault();

      const username = loginForm.username.value;
      const password = loginForm.password.value;

      errorMessage.textContent = ''; // Clear previous errors

      try {
        const response = await fetch('/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username, password }),
        });

        const data = await response.json();

        if (data.success) {
          window.location.href = '/'; // Redirect to dashboard
        } else {
          errorMessage.textContent = data.message || 'Login failed';
        }
      } catch (error) {
        console.error('Login request failed:', error);
        errorMessage.textContent = 'An error occurred during login.';
      }
    });
  }
});