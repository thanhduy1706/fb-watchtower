import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'node:fs/promises';
import path from 'node:path';

chromium.use(stealthPlugin());

async function main() {
  console.log('Starting interactive browser for Facebook authentication...');

  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  const page = await context.newPage();

  console.log('\n======================================================');
  console.log('                 ACTION REQUIRED                       ');
  console.log('Please log in to Facebook in the opened browser window.');
  console.log('The script will automatically detect when you have     ');
  console.log('successfully logged in by waiting for the feed to load.');
  console.log('======================================================\n');

  await page.goto('https://www.facebook.com/login', { waitUntil: 'domcontentloaded' });

  
  console.log('Waiting for successful login...');

  let isLoggedIn = false;
  for (let i = 0; i < 300; i++) { 
    const currentCookies = await context.cookies();
    if (currentCookies.some(c => c.name === 'c_user')) {
      isLoggedIn = true;
      break;
    }
    await page.waitForTimeout(1000);
  }

  if (!isLoggedIn) {
     console.error('Timed out waiting for login. Please try again.');
     await browser.close();
     process.exit(1);
  }

  console.log('✅ Successfully detected login (c_user cookie found).');

  
  await page.waitForTimeout(3000);

  
  const cookies = await context.cookies();

  
  const fbCookies = cookies.filter(c => c.domain.includes('facebook.com'));

  console.log(`Extracted ${fbCookies.length} Facebook cookies.`);

  
  const envPath = path.resolve(process.cwd(), '.env');
  let envContent = '';
  try {
    envContent = await fs.readFile(envPath, 'utf-8');
  } catch {
    console.log('.env file not found. Creating a new one.');
  }

  const cookiesJson = JSON.stringify(fbCookies);

  
  if (envContent.includes('FACEBOOK_COOKIES=')) {
    
    envContent = envContent.replace(/^FACEBOOK_COOKIES=.*$/m, `FACEBOOK_COOKIES=${cookiesJson}`);
  } else {
    
    
    if (envContent && !envContent.endsWith('\n')) {
      envContent += '\n';
    }
    envContent += `FACEBOOK_COOKIES=${cookiesJson}\n`;
  }

  await fs.writeFile(envPath, envContent, 'utf-8');
  console.log('✅ Successfully updated .env with new FACEBOOK_COOKIES.');

  await browser.close();
  console.log('Browser closed. Authentication script complete. You can now start the monitoring agent normally.');
}

main().catch(err => {
  console.error('Error in auth script:', err);
  process.exit(1);
});
