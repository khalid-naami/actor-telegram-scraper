import { Actor } from 'apify';
import { gotScraping } from 'got-scraping';
import { PlaywrightCrawler, log } from 'crawlee';
import {
    parseChannelMetadata,
    parseChannelPosts
} from './extractors.js';

await Actor.init();

const input = (await Actor.getInput()) || {};
const {
    mode = 'AUTO_DETECT',
    targetUrls = [],
    searchKeywords = [],
    maxPosts = 50,
    maxItems = 30,
    proxyConfiguration
} = input;

log.info('🚀 Starting Telegram Ultimate Scraper...', {
    mode,
    targetUrlsCount: targetUrls.length,
    searchKeywordsCount: searchKeywords.length,
    maxPosts
});

const proxyConfig = proxyConfiguration ? await Actor.createProxyConfiguration(proxyConfiguration) : undefined;

// Default sample targets if nothing provided
let urlsToProcess = [...targetUrls];
let keywordsToProcess = [...searchKeywords];

if (urlsToProcess.length === 0 && keywordsToProcess.length === 0) {
    urlsToProcess = [
        'https://t.me/s/durov',
        'https://t.me/s/telegram'
    ];
    log.info('ℹ️ No inputs provided. Defaulting to sample Telegram channels:', { urls: urlsToProcess });
}

function buildHeaders() {
    return {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Upgrade-Insecure-Requests': '1'
    };
}

// Fast HTML fetcher
async function fetchHtml(url) {
    const proxyUrl = proxyConfig ? await proxyConfig.newUrl() : undefined;
    const response = await gotScraping({
        url,
        headers: buildHeaders(),
        proxyUrl,
        timeout: { request: 25000 },
        retry: { limit: 2 }
    });
    return response.body;
}

// Playwright crawler fallback
async function fetchWithPlaywright(url) {
    let content = '';
    const crawler = new PlaywrightCrawler({
        proxyConfiguration: proxyConfig,
        maxRequestsPerCrawl: 1,
        headless: true,
        requestHandlerTimeoutSecs: 35,
        async requestHandler({ page }) {
            content = await page.content();
        }
    });
    await crawler.run([url]);
    return content;
}

// Ensure URL points to /s/ web preview for public post history
function normalizeTelegramUrl(rawUrl) {
    let url = rawUrl.trim();
    if (!url.startsWith('http')) {
        url = `https://t.me/${url.replace(/^@/, '')}`;
    }
    const match = url.match(/t\.me\/(?:s\/)?([a-zA-Z0-9_]+)/i);
    if (match) {
        return {
            previewUrl: `https://t.me/s/${match[1]}`,
            directUrl: `https://t.me/${match[1]}`,
            username: match[1]
        };
    }
    return { previewUrl: url, directUrl: url, username: null };
}

const stats = {
    channels: 0,
    posts: 0,
    discoveredChannels: 0,
    failed: 0
};

// 1. PROCESS TARGET URLS
for (const rawUrl of urlsToProcess) {
    const { previewUrl, directUrl, username } = normalizeTelegramUrl(rawUrl);
    if (!username) continue;

    log.info(`🎯 Scraping Telegram Channel: @${username} (${previewUrl})`);

    try {
        let html = '';
        try {
            html = await fetchHtml(previewUrl);
        } catch (fetchErr) {
            log.warning(`⚠️ HTTP fetch error for ${previewUrl} (${fetchErr.message}). Fallback to browser...`);
            html = await fetchWithPlaywright(previewUrl);
        }

        // Extract channel info
        const channelMeta = parseChannelMetadata(html, directUrl);
        if (channelMeta) {
            await Actor.pushData(channelMeta);
            stats.channels++;
            log.info(`✅ Successfully scraped Channel: ${channelMeta.channelName} [Subscribers: ${channelMeta.subscribersCount}]`);
        }

        // Extract posts
        if (mode !== 'CHANNELS') {
            const posts = parseChannelPosts(html, maxPosts);
            for (const post of posts) {
                await Actor.pushData(post);
            }
            stats.posts += posts.length;
            log.info(`💬 Extracted ${posts.length} messages for channel: @${username}`);
        }

    } catch (err) {
        log.error(`❌ Error scraping @${username}: ${err.message}`);
        stats.failed++;
    }
}

// 2. PROCESS CHANNEL FINDER BY KEYWORD
if (keywordsToProcess.length > 0) {
    for (const keyword of keywordsToProcess) {
        log.info(`🔍 Searching public Telegram channels for: "${keyword}"`);
        try {
            const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:t.me/s/ "${keyword}"`)}`;
            const searchHtml = await fetchHtml(searchUrl);

            const channelRegex = /https?:\/\/t\.me\/s\/([a-zA-Z0-9_]+)/gi;
            const matches = searchHtml.match(channelRegex) || [];
            const uniquePreviewUrls = [...new Set(matches)].slice(0, maxItems);

            log.info(`🔗 Discovered ${uniquePreviewUrls.length} candidate Telegram channels for "${keyword}"`);

            for (const previewUrl of uniquePreviewUrls) {
                try {
                    const html = await fetchHtml(previewUrl);
                    const channelMeta = parseChannelMetadata(html, previewUrl);
                    if (channelMeta) {
                        channelMeta.searchQuery = keyword;
                        await Actor.pushData(channelMeta);
                        stats.discoveredChannels++;
                        log.info(`🎉 Discovered & Verified Channel: ${channelMeta.channelName} (@${channelMeta.channelUsername})`);
                    }
                } catch (_) {}
            }
        } catch (err) {
            log.error(`❌ Channel finder failed for "${keyword}": ${err.message}`);
            stats.failed++;
        }
    }
}

// Save summary report
const summary = {
    status: 'COMPLETED',
    timestamp: new Date().toISOString(),
    metrics: stats,
    totalRecordsExtracted: stats.channels + stats.posts + stats.discoveredChannels,
    message: 'Telegram Ultimate Scraper completed successfully.'
};

await Actor.setValue('OUTPUT', summary);
log.info('🏁 Execution Finished. Executive Summary:', summary);

await Actor.exit();
