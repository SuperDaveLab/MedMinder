import puppeteer from 'puppeteer-core';

const capture = async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 414, height: 896, deviceScaleFactor: 2 });

  console.log('Navigating to Care view...');
  await page.goto('http://localhost:5173/?view=care', { waitUntil: 'networkidle0' });
  await page.screenshot({ path: 'public/screenshot-care.png' });
  
  console.log('Navigating to History view...');
  await page.goto('http://localhost:5173/?view=history', { waitUntil: 'networkidle0' });
  await page.screenshot({ path: 'public/screenshot-history.png' });
  
  console.log('Navigating to Meds view...');
  await page.goto('http://localhost:5173/?view=meds', { waitUntil: 'networkidle0' });
  await page.screenshot({ path: 'public/screenshot-meds.png' });
  
  console.log('Navigating to Admin view...');
  await page.goto('http://localhost:5173/?view=more', { waitUntil: 'networkidle0' });
  await page.screenshot({ path: 'public/screenshot-admin.png' });

  console.log('Screenshots saved to public/');
  await browser.close();
};

capture();
