import { Actor } from 'apify';
import { gotScraping } from 'got-scraping';
import { PlaywrightCrawler, RequestQueue, log } from 'crawlee';
import {
    parseChannelMetadata,
    parseChannelPosts,
    extractNextBeforeCursor,
    parseTgramSearchCards,
    parseTgramResolveHandle,
    parseCombotResults,
    normalizeTelegramUrl,
    sanitizeRecord,
} from './extractors.js';

const RESERVED_HANDLES = new Set([
    's', 'joinchat', 'addstickers', 'iv', 'share', 'proxy', 'socks',
    'setlanguage', 'telegram', 'usearchrobot', 'tgsaddbot', 'tgramsbot',
]);

const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'for', 'of', 'in', 'on', 'to', 'by', 'with',
    'community', 'communities', 'channel', 'channels', 'group', 'groups',
    'telegram', 'official', 'best', 'top', 'free', 'public', 'chat',
]);

function buildQueryVariants(keyword) {
    const clean = String(keyword || '').trim();
    if (!clean) return [];
    const variants = [clean];
    const words = clean
        .split(/\s+/)
        .map((w) => w.replace(/[^\p{L}\p{N}_-]/gu, ''))
        .filter(Boolean);
    const meaningful = words.filter((w) => !STOP_WORDS.has(w.toLowerCase()) && w.length >= 2);
    if (meaningful.length >= 2) {
        const core = meaningful.slice(0, 2).join(' ');
        if (!variants.some((v) => v.toLowerCase() === core.toLowerCase())) {
            variants.push(core);
        }
    }
    if (meaningful.length >= 1) {
        for (const w of meaningful.slice(0, 2)) {
            if (w.length >= 4 && !variants.some((v) => v.toLowerCase() === w.toLowerCase())) {
                variants.push(w);
            }
        }
    }
    return variants;
}

function isProxyTransportError(errOrStatus) {
    const msg = String(errOrStatus?.message || errOrStatus || '');
    return errOrStatus === 597 || errOrStatus === 407 || /597|UPSTREAM407|407|Proxy responded with|tunneling socket/i.test(msg);
}

await Actor.init();

try {
    const input = (await Actor.getInput()) || {};
    const {
        mode = 'AUTO_DETECT',
        targetUrls = [],
        searchKeywords = [],
        maxPosts = 50,
        maxItems = 30,
        proxyConfiguration,
    } = input;

    const safeMaxPosts = Math.max(1, Math.min(2000, Number(maxPosts) || 50));
    const safeMaxItems = Math.max(1, Math.min(1000, Number(maxItems) || 30));

    log.info('🚀 Starting Telegram Ultimate Scraper...', {
        mode,
        targetUrlsCount: targetUrls.length,
        searchKeywordsCount: searchKeywords.length,
        maxPosts: safeMaxPosts,
        maxItems: safeMaxItems,
    });

    let proxyConfig;
    if (proxyConfiguration) {
        try {
            proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);
        } catch (proxyErr) {
            log.warning(`⚠️ Proxy configuration skipped (${proxyErr.message}). Falling back to direct connection.`);
        }
    }

    let urlsToProcess = Array.isArray(targetUrls) ? [...targetUrls] : [];
    let keywordsToProcess = Array.isArray(searchKeywords) ? [...searchKeywords] : [];

    if (urlsToProcess.length === 0 && keywordsToProcess.length === 0) {
        if (mode === 'CHANNEL_FINDER') {
            keywordsToProcess = ['artificial intelligence', 'crypto trading signals'];
            log.info('ℹ️ No keywords provided for CHANNEL_FINDER. Defaulting to sample keywords:', { keywords: keywordsToProcess });
        } else {
            urlsToProcess = [
                'https://t.me/s/durov',
                'https://t.me/s/telegram',
            ];
            log.info('ℹ️ No inputs provided. Defaulting to sample Telegram channels:', { urls: urlsToProcess });
        }
    }

    async function fetchHtml(url, { accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', useProxy = true } = {}) {
        const proxyUrl = useProxy && proxyConfig ? await proxyConfig.newUrl() : undefined;
        const response = await gotScraping({
            url,
            proxyUrl,
            headerGeneratorOptions: {
                browsers: ['chrome'],
                operatingSystems: ['windows', 'macos', 'linux'],
                locales: ['en-US'],
            },
            headers: {
                'Accept': accept,
                'Accept-Language': 'en-US,en;q=0.9',
            },
            timeout: { request: 20000 },
            retry: { limit: 2 },
            throwHttpErrors: true,
        });
        return response.body;
    }

    async function fetchWithPlaywright(url) {
        let content = '';
        let statusCode = 0;
        const queueName = `tg-pw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const requestQueue = await RequestQueue.open(queueName);

        try {
            const crawler = new PlaywrightCrawler({
            maxConcurrency: 2,
                requestQueue,
                proxyConfiguration: proxyConfig,
                maxRequestsPerCrawl: 1,
                maxRequestRetries: 1,
                headless: true,
                requestHandlerTimeoutSecs: 35,
                preNavigationHooks: [
                    async ({ page }, gotoOptions) => {
                        await page.route('**/*.{mp4,webm,avi,woff,woff2}', (route) => route.abort().catch(() => {}));
                        gotoOptions.waitUntil = 'domcontentloaded';
                    },
                ],
                async requestHandler({ page, response }) {
                    statusCode = response ? response.status() : 200;
                    if (statusCode >= 400) {
                        throw new Error(`HTTP ${statusCode} on ${url}`);
                    }
                    await page.waitForSelector('.tgme_channel_info, .tgme_page_title, .tgme_widget_message_wrap', { timeout: 6000 }).catch(() => {});
                    content = await page.content();
                },
            });
            await crawler.run([url]);
        } finally {
            await requestQueue.drop().catch(() => {});
        }
        return content;
    }

    async function fetchTelegramPage(url) {
        try {
            const html = await fetchHtml(url);
            if (html && (html.includes('tgme_') || html.includes('<html'))) {
                return html;
            }
            throw new Error('Empty or invalid HTML body');
        } catch (fetchErr) {
            log.warning(`⚠️ HTTP fetch error for ${url} (${fetchErr.message}). Fallback to Playwright...`);
            return await fetchWithPlaywright(url);
        }
    }

    async function discoverCandidatesForKeyword(keyword, limit) {
        const variants = buildQueryVariants(keyword);
        const candidatesMap = new Map(); // lowercase username -> { username, source, score }

        const addCandidate = (rawUsername, source, score = 1) => {
            if (!rawUsername) return;
            const clean = String(rawUsername).replace(/^@/, '').trim();
            if (!/^[a-zA-Z0-9_]{3,64}$/.test(clean)) return;
            const lower = clean.toLowerCase();
            if (RESERVED_HANDLES.has(lower) || lower.endsWith('bot')) return;
            const existing = candidatesMap.get(lower);
            if (!existing || score > existing.score) {
                candidatesMap.set(lower, { username: clean, source, score });
            }
        };

        // Source 1: TgramSearch directory
        for (const variant of variants.slice(0, 2)) {
            if (candidatesMap.size >= limit * 2) break;
            try {
                const searchUrl = `https://tgramsearch.com/search?query=${encodeURIComponent(variant)}`;
                const searchHtml = await fetchHtml(searchUrl);
                const cards = parseTgramSearchCards(searchHtml);
                const toResolve = cards.slice(0, Math.min(cards.length, Math.max(limit * 2, 12)));

                const batchSize = 5;
                for (let i = 0; i < toResolve.length && candidatesMap.size < limit * 2; i += batchSize) {
                    const batch = toResolve.slice(i, i + batchSize);
                    const resolved = await Promise.all(
                        batch.map(async (card) => {
                            try {
                                const joinUrl = `https://tgramsearch.com${card.joinPath}`;
                                const joinHtml = await fetchHtml(joinUrl);
                                return parseTgramResolveHandle(joinHtml);
                            } catch {
                                return null;
                            }
                        })
                    );
                    resolved.forEach((handle, idx) => {
                        if (handle) {
                            const priority = variant === keyword ? 100 : 60;
                            addCandidate(handle, 'tgramsearch', priority - idx);
                        }
                    });
                }
            } catch (err) {
                log.debug(`TgramSearch lookup failed for "${variant}": ${err.message}`);
            }
        }

        // Source 2: Combot public directory JSON API
        for (const variant of variants) {
            if (candidatesMap.size >= limit * 2) break;
            try {
                const combotUrl = `https://combot.org/api/chart/all?limit=25&offset=0&q=${encodeURIComponent(variant)}`;
                const body = await fetchHtml(combotUrl, {
                    accept: 'application/json,text/plain,*/*',
                });
                const parsed = parseCombotResults(JSON.parse(body));
                for (const item of parsed) {
                    const priority = variant === keyword ? 90 : (variant.includes(' ') ? 70 : 40);
                    addCandidate(item.username, 'combot', priority);
                }
            } catch (err) {
                log.debug(`Combot lookup failed for "${variant}": ${err.message}`);
            }
        }

        // Source 3: HN Algolia fallback if directory results are sparse
        if (candidatesMap.size < limit) {
            try {
                const hnQuery = variants[1] || variants[0];
                const hnUrl = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(`t.me ${hnQuery}`)}&hitsPerPage=20`;
                const hnBody = await fetchHtml(hnUrl, {
                    accept: 'application/json',
                });
                const matches = [...hnBody.matchAll(/t\.me\/(?:s\/)?([a-zA-Z0-9_]{4,32})/gi)].map((m) => m[1]);
                for (const handle of matches) {
                    addCandidate(handle, 'hn_algolia', 20);
                }
            } catch (err) {
                log.debug(`HN Algolia lookup failed for "${keyword}": ${err.message}`);
            }
        }

        return [...candidatesMap.values()]
            .sort((a, b) => b.score - a.score)
            .slice(0, Math.max(limit * 2, limit));
    }

    const stats = {
        channels: 0,
        posts: 0,
        discoveredChannels: 0,
        failed: 0,
    };
    const diagnostics = [];

    // 1. PROCESS TARGET URLS (skip if CHANNEL_FINDER mode explicitly requested)
    if (mode !== 'CHANNEL_FINDER' && urlsToProcess.length > 0) {
        const slicedUrls = urlsToProcess.slice(0, safeMaxItems);
        for (const rawUrl of slicedUrls) {
            const { previewUrl, directUrl, username, postId } = normalizeTelegramUrl(rawUrl);
            if (!username) {
                log.warning(`⚠️ Skipping invalid Telegram URL: ${rawUrl}`);
                stats.failed++;
                diagnostics.push(`Invalid URL skipped: ${rawUrl}`);
                continue;
            }

            log.info(`🎯 Scraping Telegram Channel: @${username} (${previewUrl})`);

            try {
                let html = await fetchTelegramPage(previewUrl);
                let channelMeta = parseChannelMetadata(html, directUrl);

                if (!channelMeta && directUrl !== previewUrl) {
                    const directHtml = await fetchTelegramPage(directUrl);
                    channelMeta = parseChannelMetadata(directHtml, directUrl);
                    if (channelMeta) html = directHtml;
                }

                if (!channelMeta) {
                    throw new Error(`Channel @${username} does not exist or is not a public Telegram channel/group`);
                }

                if (mode !== 'POSTS') {
                    await Actor.pushData(channelMeta);
                    stats.channels++;
                    log.info(`✅ Successfully scraped Channel: ${channelMeta.channelName} [Subscribers: ${channelMeta.subscribersCount}]`);
                }

                // Extract posts with ?before= pagination up to safeMaxPosts
                if (mode !== 'CHANNELS') {
                    const seenPostIds = new Set();
                    const collectedPosts = [];
                    let pageHtml = html;
                    let pageCount = 0;
                    const maxPages = Math.min(100, Math.ceil(safeMaxPosts / 15) + 3);
                    let lastCursor = null;

                    if (postId) {
                        // Fetch around a specific post URL if provided (e.g. t.me/durov/536)
                        const specificUrl = `${previewUrl}?before=${postId + 1}`;
                        pageHtml = await fetchTelegramPage(specificUrl);
                    }

                    while (collectedPosts.length < safeMaxPosts && pageCount < maxPages && pageHtml) {
                        pageCount++;
                        const remaining = safeMaxPosts - collectedPosts.length;
                        const pagePosts = parseChannelPosts(pageHtml, Math.max(remaining, 25));

                        let addedOnPage = 0;
                        const ordered = [...pagePosts].reverse(); // newest-first order within page
                        for (const post of ordered) {
                            if (postId && pageCount === 1 && post.messageId !== postId) continue;
                            if (!seenPostIds.has(post.id)) {
                                seenPostIds.add(post.id);
                                collectedPosts.push(post);
                                addedOnPage++;
                                if (collectedPosts.length >= safeMaxPosts) break;
                            }
                        }

                        if (postId || collectedPosts.length >= safeMaxPosts || addedOnPage === 0) {
                            break;
                        }

                        const nextCursor = extractNextBeforeCursor(pageHtml);
                        if (!nextCursor || nextCursor <= 1 || nextCursor === lastCursor) {
                            break;
                        }
                        lastCursor = nextCursor;
                        pageHtml = await fetchTelegramPage(`${previewUrl}?before=${nextCursor}`);
                    }

                    if (collectedPosts.length > 0) {
                        await Actor.pushData(collectedPosts);
                        stats.posts += collectedPosts.length;
                    }
                    log.info(`💬 Extracted ${collectedPosts.length} messages for channel: @${username}`);
                }
            } catch (err) {
                log.error(`❌ Error scraping @${username}: ${err.message}`);
                stats.failed++;
                diagnostics.push(`@${username}: ${err.message}`);
            }
        }
    }

    // 2. PROCESS CHANNEL FINDER BY KEYWORD
    if (keywordsToProcess.length > 0 && mode !== 'POSTS') {
        const seenDiscovered = new Set();

        for (const keyword of keywordsToProcess) {
            log.info(`🔍 Searching public Telegram channels for: "${keyword}"`);
            try {
                const candidates = await discoverCandidatesForKeyword(keyword, safeMaxItems);
                log.info(`🔗 Discovered ${candidates.length} candidate Telegram channels for "${keyword}"`);

                let verifiedForKeyword = 0;
                for (const candidate of candidates) {
                    if (verifiedForKeyword >= safeMaxItems) break;
                    const lower = candidate.username.toLowerCase();
                    if (seenDiscovered.has(lower)) continue;

                    const previewUrl = `https://t.me/s/${candidate.username}`;
                    try {
                        const html = await fetchHtml(previewUrl);
                        const channelMeta = parseChannelMetadata(html, previewUrl);
                        if (!channelMeta) {
                            log.debug(`Skipping unverified/private candidate @${candidate.username}`);
                            continue;
                        }

                        seenDiscovered.add(lower);
                        const enriched = sanitizeRecord({
                            ...channelMeta,
                            searchQuery: keyword,
                            source: candidate.source,
                        });
                        await Actor.pushData(enriched);
                        stats.discoveredChannels++;
                        verifiedForKeyword++;
                        log.info(`🎉 Discovered & Verified Channel: ${enriched.channelName} (${enriched.channelUsername}) [source: ${candidate.source}]`);
                    } catch (verifyErr) {
                        log.debug(`Could not verify @${candidate.username}: ${verifyErr.message}`);
                    }
                }

                if (verifiedForKeyword === 0) {
                    diagnostics.push(`Keyword "${keyword}": ${candidates.length} candidates found, 0 verified live`);
                }
            } catch (err) {
                log.error(`❌ Channel finder failed for "${keyword}": ${err.message}`);
                stats.failed++;
                diagnostics.push(`Keyword "${keyword}": ${err.message}`);
            }
        }
    }

    const totalRecordsExtracted = stats.channels + stats.posts + stats.discoveredChannels;
    const summary = {
        status: totalRecordsExtracted > 0 ? 'COMPLETED' : 'FAILED',
        timestamp: new Date().toISOString(),
        metrics: stats,
        totalRecordsExtracted,
        diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
        message: totalRecordsExtracted > 0
            ? 'Telegram Ultimate Scraper completed successfully.'
            : 'Telegram Ultimate Scraper extracted 0 records.',
    };

    await Actor.setValue('OUTPUT', summary);
    log.info('🏁 Execution Finished. Executive Summary:', summary);

    if (totalRecordsExtracted === 0) {
        const reason = diagnostics.length > 0 ? diagnostics.join('; ') : 'No valid channels, posts, or search results matched.';
        await Actor.fail(`Extracted 0 Telegram records. ${reason}`);
    }
} catch (fatalErr) {
    log.exception(fatalErr, '💥 Fatal error in Telegram Ultimate Scraper');
    await Actor.fail(fatalErr.message);
} finally {
    await Actor.exit();
}
