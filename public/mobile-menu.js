document.addEventListener('DOMContentLoaded', () => {
    console.log('mobile-menu.js loaded');
    const menuButton = document.getElementById('mobile-menu-button');
    const navDropdown = document.querySelector('#nav-dropdown');
    const navDropdownButton = document.getElementById('nav-dropdown-button');

    if (menuButton) {
        console.log('Mobile menu button found:', menuButton);
    } else {
        console.log('Mobile menu button NOT found');
    }

    if (navDropdown) {
        console.log('Nav dropdown found:', navDropdown);
    } else {
        console.log('Nav dropdown NOT found');
    }

    if (menuButton && navDropdown) {
        // Handle mobile menu button click
        menuButton.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent event bubbling
            console.log('Mobile menu button clicked');
            navDropdown.classList.toggle('open');
            console.log('Nav dropdown class list:', navDropdown.classList);
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!menuButton.contains(e.target) && !navDropdown.contains(e.target)) {
                navDropdown.classList.remove('open');
            }
        });
        
        // Close dropdown when clicking on a nav link
        const navLinks = navDropdown.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                navDropdown.classList.remove('open');
            });
        });
    }
    
    // Handle desktop dropdown button click (for non-mobile view)
    if (navDropdownButton) {
        navDropdownButton.addEventListener('click', (e) => {
            e.stopPropagation();
            navDropdown.classList.toggle('open');
        });
    }
});
