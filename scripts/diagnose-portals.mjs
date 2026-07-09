import { chromium } from 'playwright';
import { extractRequirements } from '../dist/careerJobFields.js';
import { matchesJobKeyword } from '../dist/careerKeywordMatch.js';

const browser = await chromium.launch({ channel: 'msedge', headless: true });

// 阿里
{
    const page = await browser.newPage();
    const url = `https://campus-talent.alibaba.com/campus/position?keywords=${encodeURIComponent('产品经理')}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(8000);
    const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href*="/campus/position/"]')).map((a) => ({
            href: a.href,
            text: (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80)
        }))
    );
    const pm = links.filter((l) => /产品/.test(l.text));
    console.log('阿里 产品相关链接:', pm.length);
    for (const l of pm.slice(0, 3)) {
        const dp = await browser.newPage();
        await dp.goto(l.href, { timeout: 30000 });
        await dp.waitForTimeout(5000);
        const text = await dp.locator('body').innerText();
        const req = extractRequirements(text);
        console.log(' ', l.text.slice(0, 50));
        console.log('   kw', matchesJobKeyword(text, 'AI产品经理'), 'req', req?.slice(0, 80));
        await dp.close();
    }
    await page.close();
}

// 美团
{
    const page = await browser.newPage();
    await page.goto(`https://zhaopin.meituan.com/web/position?keyword=${encodeURIComponent('产品经理')}`, {
        waitUntil: 'networkidle',
        timeout: 60000
    });
    await page.waitForTimeout(12000);
    const allLinks = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]'))
            .map((a) => ({ href: a.href, text: (a.innerText || '').trim().slice(0, 40) }))
            .filter((x) => x.href.includes('position'))
    );
    console.log('美团 position链接数:', allLinks.length);
    for (const l of allLinks.slice(0, 6)) {
        console.log(' ', l.text, '->', l.href.slice(0, 90));
    }
    await page.close();
}

// 腾讯
{
    const page = await browser.newPage();
    await page.goto(`https://join.qq.com/post.html?query=${encodeURIComponent('产品经理')}`, {
        waitUntil: 'networkidle',
        timeout: 60000
    });
    await page.waitForTimeout(10000);
    const jobs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[class*="post"], [class*="job"], [class*="position"], li, tr'))
            .map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim())
            .filter((t) => t.includes('产品') && t.length < 120)
            .slice(0, 8)
    );
    console.log('腾讯 含产品文本块:', jobs.length);
    for (const j of jobs.slice(0, 5)) {
        console.log(' ', j.slice(0, 70));
    }
    await page.close();
}

// 京东
{
    const page = await browser.newPage();
    await page.goto(`https://campus.jd.com/#/jobs?keyword=${encodeURIComponent('产品经理')}`, {
        waitUntil: 'networkidle',
        timeout: 60000
    });
    await page.waitForTimeout(12000);
    const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href], [class*="job"], [class*="position"]'))
            .map((el) => ({
                href: el.href || '',
                text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60)
            }))
            .filter((x) => /产品|job|position/i.test(x.href + x.text))
            .slice(0, 10)
    );
    console.log('京东 候选:', links.length);
    for (const l of links) {
        console.log(' ', l.text, '->', l.href.slice(0, 90));
    }
    await page.close();
}

await browser.close();
