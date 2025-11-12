const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: false, // Keep browser visible
    defaultViewport: null, // Use default viewport
    args: ['--start-maximized'] // Start maximized
  });
  
  const page = await browser.newPage();
  
  // Navigate to the dashboard
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
  
  console.log('Dashboard loaded. Waiting for user interaction...');
  
  // Add authentication if needed
  try {
    // Check if we're on the login page
    const loginPage = await page.$('input[name="username"]');
    if (loginPage) {
      console.log('Login page detected. Authenticating...');
      
      // Fill in credentials
      await page.type('input[name="username"]', 'admin');
      await page.type('input[name="password"]', 'adminpass');
      
      // Submit form
      await page.click('button[type="submit"]');
      
      // Wait for navigation after login
      await page.waitForNavigation({ waitUntil: 'networkidle2' });
      console.log('Logged in successfully');
    }
  } catch (error) {
    console.log('Authentication not needed or failed:', error.message);
  }
  
  // Wait for the dashboard to load completely
  await page.waitForSelector('#balancesChart', { timeout: 10000 });
  
  // Take a screenshot of the dashboard
  await page.screenshot({ path: 'dashboard-initial.png', fullPage: true });
  
  console.log('Dashboard loaded and screenshot taken.');
  
  // Keep browser open for manual inspection
  console.log('Browser will remain open for manual inspection. Close the browser to exit.');
  
  // Wait for browser to close
  await new Promise(resolve => {
    browser.on('disconnected', () => {
      console.log('Browser closed. Exiting.');
      resolve();
    });
  });
  
  await browser.close();
})();