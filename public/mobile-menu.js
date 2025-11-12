document.addEventListener('DOMContentLoaded', () => {
  const menuButton = document.getElementById('mobile-menu-button');
  const navDropdown = document.querySelector('#nav-dropdown');
  const brandButton = document.getElementById('brand');

  if (menuButton && navDropdown) {
    const closeDropdown = () => {
      navDropdown.classList.remove('open');
      menuButton.setAttribute('aria-expanded', 'false');
    };

    const toggleDropdown = (event) => {
      event.stopPropagation();
      navDropdown.classList.toggle('open');
      const expanded = navDropdown.classList.contains('open');
      menuButton.setAttribute('aria-expanded', expanded.toString());
    };

    menuButton.setAttribute('aria-haspopup', 'true');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.addEventListener('click', toggleDropdown);

    document.addEventListener('click', (event) => {
      if (!navDropdown.contains(event.target) && !menuButton.contains(event.target)) {
        closeDropdown();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeDropdown();
      }
    });

    const navLinks = navDropdown.querySelectorAll('.nav-link');
    navLinks.forEach((link) => {
      link.addEventListener('click', () => {
        closeDropdown();
      });
    });
  }

  if (brandButton) {
    brandButton.setAttribute('role', 'link');
    brandButton.setAttribute('tabindex', '0');
    const navigateHome = () => {
      window.location.href = '/';
    };
    brandButton.addEventListener('click', navigateHome);
    brandButton.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        navigateHome();
      }
    });
    brandButton.style.cursor = 'pointer';
  }
});
