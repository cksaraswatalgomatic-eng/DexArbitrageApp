document.addEventListener('DOMContentLoaded', () => {
  const menuButton = document.getElementById('nav-dropdown-button') || document.getElementById('mobile-menu-button');
  const navDropdown = document.querySelector('#nav-dropdown');
  const brandButton = document.getElementById('brand');

  if (menuButton && navDropdown) {
    let hoverTimeout = null;
    const supportsHover = window.matchMedia('(hover: hover)').matches;

    const openDropdown = () => {
      navDropdown.classList.add('open');
      menuButton.setAttribute('aria-expanded', 'true');
    };

    const closeDropdown = () => {
      navDropdown.classList.remove('open');
      menuButton.setAttribute('aria-expanded', 'false');
    };

    const scheduleClose = () => {
      if (!supportsHover) return;
      clearTimeout(hoverTimeout);
      hoverTimeout = setTimeout(() => {
        closeDropdown();
      }, 200);
    };

    const handleHoverOpen = () => {
      if (!supportsHover) return;
      clearTimeout(hoverTimeout);
      openDropdown();
    };

    const toggleDropdown = (event) => {
      event.stopPropagation();
      if (navDropdown.classList.contains('open')) {
        closeDropdown();
      } else {
        openDropdown();
      }
    };

    menuButton.setAttribute('aria-haspopup', 'true');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.addEventListener('click', toggleDropdown);

    if (supportsHover) {
      menuButton.addEventListener('mouseenter', handleHoverOpen);
      menuButton.addEventListener('mouseleave', scheduleClose);
      navDropdown.addEventListener('mouseenter', handleHoverOpen);
      navDropdown.addEventListener('mouseleave', scheduleClose);
    }

    document.addEventListener('click', (event) => {
      if (!navDropdown.contains(event.target) && !menuButton.contains(event.target)) {
        clearTimeout(hoverTimeout);
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
        clearTimeout(hoverTimeout);
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
