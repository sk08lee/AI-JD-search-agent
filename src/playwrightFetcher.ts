import type { Browser } from 'playwright';

let browserPromise: Promise<Browser> | null = null;
let browserUnavailable = false;

export function isPlaywrightFetchEnabled(): boolean {
    return process.env.ENABLE_PLAYWRIGHT_FETCH !== '0';
}

export async function fetchPageWithPlaywright(url: string, waitMs = 5000): Promise<string> {
    if (!isPlaywrightFetchEnabled()) {
        throw new Error('Playwright fetch is disabled');
    }

    const browser = await getBrowser();
    const page = await browser.newPage({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    try {
        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await page.waitForTimeout(waitMs);
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);

        const text = await page.locator('body').innerText();
        return text.replace(/\s+/g, ' ').trim();
    } finally {
        await page.close();
    }
}

async function getBrowser(): Promise<Browser> {
    if (browserUnavailable) {
        throw new Error('Playwright browser is unavailable');
    }

    if (!browserPromise) {
        browserPromise = launchBrowser().catch((error) => {
            browserPromise = null;
            browserUnavailable = true;
            throw error;
        });
    }

    return browserPromise;
}

async function launchBrowser(): Promise<Browser> {
    const { chromium } = await import('playwright');
    return chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
}

export async function closePlaywrightBrowser(): Promise<void> {
    if (!browserPromise) return;
    const browser = await browserPromise.catch(() => null);
    browserPromise = null;
    if (browser) {
        await browser.close();
    }
}
