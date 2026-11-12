/**
 * Telegram Ultimate Scraper - Extractors & Parsers
 * High-speed parsing for Public Telegram Channels, Posts, Reactions, Media, and Directories.
 */

const ENTITY_MAP = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
};

export function decodeHtmlEntities(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/&([a-zA-Z]+);/g, (full, name) => ENTITY_MAP[name.toLowerCase()] ?? full)
        .replace(/&#(\d+);/g, (full, dec) => {
            const cp = Number.parseInt(dec, 10);
            return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : full;
        })
        .replace(/&#x([0-9a-fA-F]+);/g, (full, hex) => {
            const cp = Number.parseInt(hex, 16);
            return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : full;
        });
}

export function sanitizeRecord(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => sanitizeRecord(item))
            .filter((item) => item !== null && item !== undefined);
    }
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (v === null || v === undefined) continue;
            if (Array.isArray(v)) {
                const cleaned = sanitizeRecord(v);
                out[k] = cleaned;
            } else if (typeof v === 'object') {
                out[k] = sanitizeRecord(v);
            } else {
                out[k] = v;
            }
        }
        return out;
    }
    return value;
}

// Helper to extract email addresses
export function extractEmails(text) {
    if (!text || typeof text !== 'string') return [];
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    const matches = text.match(emailRegex) || [];
    const ignored = ['telegram.org', 't.me', 'example.com'];
    const unique = [...new Set(matches.map((m) => m.trim().toLowerCase()))];
    return unique.filter((e) => !ignored.some((d) => e.endsWith(`@${d}`)));
}

// Helper to extract phone numbers
export function extractPhones(text) {
    if (!text || typeof text !== 'string') return [];
    const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,5}/g;
    const matches = text.match(phoneRegex) || [];
    const valid = matches
        .map((p) => p.trim())
        .filter((p) => {
            const digits = p.replace(/\D/g, '');
            return digits.length >= 8 && digits.length <= 15;
        });
    return [...new Set(valid)];
}

// Helper to extract external links from text and anchor hrefs
export function extractExternalLinks(text, htmlSnippet = '') {
    const urls = [];
    if (text && typeof text === 'string') {
        const textMatches = text.match(/https?:\/\/[^\s<>"')]+/gi) || [];
        urls.push(...textMatches);
    }
    if (htmlSnippet && typeof htmlSnippet === 'string') {
        const hrefRegex = /href="(https?:\/\/[^"]+)"/gi;
        let m;
        while ((m = hrefRegex.exec(htmlSnippet)) !== null) {
            urls.push(decodeHtmlEntities(m[1]));
        }
    }
    const cleaned = urls
        .map((u) => u.replace(/[.,;!?)]+$/, '').trim())
        .filter((u) => {
            if (!u) return false;
            try {
                const host = new URL(u).hostname.toLowerCase();
                return host !== 't.me' && !host.endsWith('.t.me') && host !== 'telegram.org' && !host.endsWith('.telegram.org');
            } catch {
                return false;
            }
        });
    return [...new Set(cleaned)];
}

// Parse counts like "10M", "9.14M", "16.8K", "8 401 members, 301 online", "1,250"
export function parseCount(str) {
    if (str === null || str === undefined || str === '') return 0;
    if (typeof str === 'number') return Number.isFinite(str) ? Math.round(str) : 0;
    const text = String(str).trim();
    const match = text.match(/(\d+(?:[.,\s]\d+)*)(?:\s*([KMBkmb])(?![a-zA-Z]))?/);
    if (!match) return 0;

    let numStr = match[1].replace(/\s+/g, '');
    const suffix = (match[2] || '').toUpperCase();

    if (suffix) {
        // Decimal shorthand like "9.14M" or "1,5K"
        numStr = numStr.replace(/,/g, '.');
    } else {
        // Integer counts like "8 401" or "1,234,567"
        numStr = numStr.replace(/,/g, '');
    }

    const num = Number.parseFloat(numStr);
    if (Number.isNaN(num)) return 0;

    let multiplier = 1;
    if (suffix === 'B') multiplier = 1_000_000_000;
    else if (suffix === 'M') multiplier = 1_000_000;
    else if (suffix === 'K') multiplier = 1_000;

    return Math.round(num * multiplier);
}

export function normalizeTelegramUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return { previewUrl: null, directUrl: null, username: null, postId: null };
    }
    let url = rawUrl.trim();
    if (!url) return { previewUrl: null, directUrl: null, username: null, postId: null };

    if (!/^https?:\/\//i.test(url)) {
        const cleanHandle = url.replace(/^@/, '').replace(/^\/+/, '');
        if (/^[a-zA-Z0-9_]{3,64}$/.test(cleanHandle)) {
            url = `https://t.me/${cleanHandle}`;
        } else {
            url = `https://${cleanHandle}`;
        }
    }

    const match = url.match(/t\.me\/(?:s\/)?([a-zA-Z0-9_]{3,64})(?:\/(\d+))?/i);
    if (match) {
        const username = match[1];
        const reserved = new Set(['s', 'joinchat', 'addstickers', 'iv', 'share', 'proxy', 'socks', 'setlanguage']);
        if (reserved.has(username.toLowerCase())) {
            return { previewUrl: url, directUrl: url, username: null, postId: null };
        }
        return {
            previewUrl: `https://t.me/s/${username}`,
            directUrl: `https://t.me/${username}`,
            username,
            postId: match[2] ? Number.parseInt(match[2], 10) : null,
        };
    }

    return { previewUrl: url, directUrl: url, username: null, postId: null };
}

function stripTags(html) {
    if (!html) return '';
    return decodeHtmlEntities(
        html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
    )
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

// Parse Channel Header / Metadata from t.me/s/ or t.me/ HTML
export function parseChannelMetadata(html, url = '') {
    if (!html || typeof html !== 'string') return null;

    // Must look like a real channel/group page, not a "Telegram: Contact @..." nonexistent placeholder
    const hasChannelInfo = html.includes('tgme_channel_info');
    const hasPageTitle = html.includes('tgme_page_title');
    if (!hasChannelInfo && !hasPageTitle) {
        return null;
    }

    const normalized = normalizeTelegramUrl(url);
    const htmlUsernameMatch =
        html.match(/<div class="tgme_channel_info_header_username"[^>]*>[\s\S]*?<a[^>]*href="https?:\/\/t\.me\/([a-zA-Z0-9_]+)"/i)
        || html.match(/tg:\/\/resolve\?domain=([a-zA-Z0-9_]+)/i);
    const username = normalized.username || (htmlUsernameMatch ? htmlUsernameMatch[1] : null);
    if (!username) return null;

    // Title
    const titleMatch =
        html.match(/<div class="tgme_channel_info_header_title"[^>]*>([\s\S]*?)<\/div>/i)
        || html.match(/<div class="tgme_page_title"[^>]*>([\s\S]*?)<\/div>/i)
        || html.match(/<meta property="og:title" content="([^"]*)"/i);
    const title = titleMatch ? stripTags(titleMatch[1]).replace(/\s+/g, ' ').trim() : '';

    // Placeholder / nonexistent check
    if (!title && /Telegram:\s*Contact\s*@/i.test(html)) {
        return null;
    }

    // Description / Bio
    const descMatch =
        html.match(/<div class="tgme_channel_info_description"[^>]*>([\s\S]*?)<\/div>/i)
        || html.match(/<div class="tgme_page_description"[^>]*>([\s\S]*?)<\/div>/i)
        || html.match(/<meta property="og:description" content="([^"]*)"/i);
    const descRaw = descMatch ? descMatch[1] : '';
    const description = descRaw ? stripTags(descRaw).replace(/\n{3,}/g, '\n\n').trim() : '';

    // Subscribers / Members
    let subscribersCount = '0';
    let subscribersCountRaw = 0;

    const counters = [...html.matchAll(/<div class="tgme_channel_info_counter"[^>]*>\s*<span class="counter_value"[^>]*>([\s\S]*?)<\/span>\s*<span class="counter_type"[^>]*>([\s\S]*?)<\/span>/gi)];
    if (counters.length > 0) {
        const subCounter = counters.find((c) => /subscriber|member/i.test(c[2])) || counters[0];
        const val = stripTags(subCounter[1]);
        const label = stripTags(subCounter[2]);
        subscribersCount = `${val} ${label}`.trim();
        subscribersCountRaw = parseCount(val);
    } else {
        const subMatch = html.match(/<div class="tgme_page_extra"[^>]*>([\s\S]*?)<\/div>/i);
        if (subMatch) {
            const extraText = stripTags(subMatch[1]);
            subscribersCount = extraText || '0';
            subscribersCountRaw = parseCount(extraText);
        }
    }

    // Avatar URL: <i class="tgme_page_photo_image ..."><img src="..."></i> OR <img class="tgme_page_photo_image" src="..."> OR og:image
    const avatarMatch =
        html.match(/<i class="tgme_page_photo_image[^"]*"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/i)
        || html.match(/<img[^>]*class="[^"]*tgme_page_photo_image[^"]*"[^>]*src="([^"]+)"/i)
        || html.match(/<meta property="og:image" content="([^"]+)"/i);
    const avatarUrl = avatarMatch ? decodeHtmlEntities(avatarMatch[1]) : undefined;

    // Verified badge (strict icon/badge check in header region)
    const headerRegion = html.slice(0, Math.min(html.length, 20000));
    const isVerified = /<i\s+class="[^"]*\bverified-icon\b[^"]*"/i.test(headerRegion)
        || headerRegion.includes('tgme_page_verified_badge');

    const emails = extractEmails(description);
    const phones = extractPhones(description);
    const externalLinks = extractExternalLinks(description, descRaw);

    return sanitizeRecord({
        type: 'CHANNEL',
        id: username,
        url: `https://t.me/${username}`,
        previewUrl: `https://t.me/s/${username}`,
        channelName: title || username,
        channelUsername: `@${username}`,
        channelDescription: description,
        subscribersCount: subscribersCount || '0',
        subscribersCountRaw,
        avatarUrl,
        isVerified,
        email: emails[0],
        emails: emails.length > 0 ? emails : undefined,
        phone: phones[0],
        phones: phones.length > 0 ? phones : undefined,
        externalLinks: externalLinks.length > 0 ? externalLinks : undefined,
        scrapedAt: new Date().toISOString(),
    });
}

// Parse Reactions from a single message block
export function parseMessageReactions(block) {
    if (!block) return [];
    const reactions = [];

    const reactionsContainerMatch = block.match(/<div class="tgme_widget_message_reactions[^"]*">([\s\S]*?)<\/div>/i);
    if (reactionsContainerMatch) {
        const container = reactionsContainerMatch[1];
        const spanRegex = /<span class="tgme_reaction([^"]*)">([\s\S]*?)<\/span>/gi;
        let m;
        while ((m = spanRegex.exec(container)) !== null) {
            const cls = m[1] || '';
            const inner = m[2] || '';

            const countMatch = inner.match(/([0-9]+(?:[.,][0-9]+)?\s*[KMBkmb]?)\s*$/);
            const count = countMatch ? parseCount(countMatch[1]) : 0;

            let emoji = '';
            if (cls.includes('tgme_reaction_paid') || inner.includes('icon-telegram-stars')) {
                emoji = '⭐';
            } else {
                const tgEmojiMatch = inner.match(/<tg-emoji[^>]*emoji-id="([^"]+)"[^>]*>([\s\S]*?)<\/tg-emoji>/i);
                if (tgEmojiMatch) {
                    const innerEmoji = stripTags(tgEmojiMatch[2]);
                    emoji = innerEmoji || `tg-emoji:${tgEmojiMatch[1]}`;
                } else {
                    const bMatch = inner.match(/<b[^>]*>([\s\S]*?)<\/b>/i);
                    if (bMatch) {
                        emoji = stripTags(bMatch[1]);
                    } else {
                        const withoutCount = countMatch ? inner.slice(0, countMatch.index) : inner;
                        emoji = stripTags(withoutCount);
                    }
                }
            }

            if (emoji || count > 0) {
                reactions.push({ emoji: emoji || '👍', count });
            }
        }
    }

    // Legacy markup fallback
    if (reactions.length === 0) {
        const legacyRegex = /<span class="reaction_emoji">([^<]*)<\/span>[\s\S]*?<span class="reaction_count">([^<]*)<\/span>/gi;
        let rMatch;
        while ((rMatch = legacyRegex.exec(block)) !== null) {
            reactions.push({
                emoji: decodeHtmlEntities(rMatch[1].trim()),
                count: parseCount(rMatch[2]),
            });
        }
    }

    return reactions;
}

// Parse Channel Posts from t.me/s/ HTML
export function parseChannelPosts(html, maxPosts = 50) {
    if (!html || typeof html !== 'string') return [];
    const posts = [];

    const messageBlocks = html.split('<div class="tgme_widget_message_wrap');

    for (let i = 1; i < messageBlocks.length; i++) {
        if (posts.length >= maxPosts) break;
        const block = messageBlocks[i];

        const postDataMatch = block.match(/data-post="([a-zA-Z0-9_]+)\/(\d+)"/i);
        if (!postDataMatch) continue;

        const channelUsername = postDataMatch[1];
        const messageId = Number.parseInt(postDataMatch[2], 10);
        const postUrl = `https://t.me/${channelUsername}/${messageId}`;

        // Message text
        const textMatch = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        const rawTextHtml = textMatch ? textMatch[1] : '';
        const text = rawTextHtml
            ? decodeHtmlEntities(
                rawTextHtml
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<[^>]+>/g, '')
            ).trim()
            : '';

        // Date
        const dateMatch = block.match(/<time[^>]*datetime="([^"]*)"[^>]*>/i);
        const date = dateMatch ? dateMatch[1] : undefined;

        // Views
        const viewsMatch = block.match(/<span class="tgme_widget_message_views"[^>]*>([\s\S]*?)<\/span>/i);
        const viewsText = viewsMatch ? stripTags(viewsMatch[1]) : '0';
        const viewsCountRaw = parseCount(viewsText);

        // Forwards (optional if present)
        const forwardsMatch = block.match(/<span class="tgme_widget_message_forwards"[^>]*>([\s\S]*?)<\/span>/i);
        const forwardsCount = forwardsMatch ? parseCount(stripTags(forwardsMatch[1])) : undefined;

        // Reactions
        const reactions = parseMessageReactions(block);

        // Media: collect all photos in gallery/post
        const photoUrls = [];
        const photoRegex = /class="tgme_widget_message_photo_wrap[^"]*"[^>]*style="[^"]*background-image:\s*url\(['"]?([^'")]+)['"]?\)/gi;
        let pMatch;
        while ((pMatch = photoRegex.exec(block)) !== null) {
            const pUrl = decodeHtmlEntities(pMatch[1]);
            if (pUrl && !photoUrls.includes(pUrl)) photoUrls.push(pUrl);
        }

        let mediaType = 'none';
        const photoUrl = photoUrls[0];
        if (photoUrls.length > 0) {
            mediaType = 'photo';
        }

        const videoMatch = block.match(/<video[^>]*src="([^"]*)"/i);
        const videoUrl = videoMatch ? decodeHtmlEntities(videoMatch[1]) : undefined;
        if (videoUrl || block.includes('tgme_widget_message_video_player') || block.includes('tgme_widget_message_roundvideo_player')) {
            mediaType = 'video';
        }

        if (block.includes('tgme_widget_message_document')) mediaType = 'document';
        else if (block.includes('tgme_widget_message_poll')) mediaType = 'poll';
        else if (block.includes('tgme_widget_message_voice')) mediaType = 'voice';

        const emails = extractEmails(text);
        const phones = extractPhones(text);
        const externalLinks = extractExternalLinks(text, rawTextHtml);

        posts.push(sanitizeRecord({
            type: 'POST',
            id: `${channelUsername}_${messageId}`,
            messageId,
            url: postUrl,
            channelUsername: `@${channelUsername}`,
            text,
            viewsCount: viewsText || '0',
            viewsCountRaw,
            forwardsCount,
            reactions: reactions.length > 0 ? reactions : undefined,
            mediaType,
            photoUrl,
            photoUrls: photoUrls.length > 0 ? photoUrls : undefined,
            videoUrl,
            externalLinks: externalLinks.length > 0 ? externalLinks : undefined,
            email: emails[0],
            emails: emails.length > 0 ? emails : undefined,
            phone: phones[0],
            phones: phones.length > 0 ? phones : undefined,
            date,
            scrapedAt: new Date().toISOString(),
        }));
    }

    return posts;
}

// Extract oldest message cursor (?before=<id>) from t.me/s/ HTML for backward pagination
export function extractNextBeforeCursor(html) {
    if (!html || typeof html !== 'string') return null;

    const moreMatch = html.match(/class="[^"]*tme_messages_more[^"]*"[^>]*data-before="(\d+)"/i)
        || html.match(/href="[^"]*\?before=(\d+)"[^>]*class="[^"]*tme_messages_more/i);
    if (moreMatch) {
        return Number.parseInt(moreMatch[1], 10);
    }

    const postIds = [...html.matchAll(/data-post="[a-zA-Z0-9_]+\/(\d+)"/gi)]
        .map((m) => Number.parseInt(m[1], 10))
        .filter((n) => Number.isFinite(n) && n > 1);

    if (postIds.length === 0) return null;
    return Math.min(...postIds);
}

// Parse channel search cards from tgramsearch.com/search?query=...
export function parseTgramSearchCards(html) {
    if (!html || typeof html !== 'string') return [];
    const results = [];
    const chunks = html.split('<div class="tg-channel">').slice(1);

    for (const chunk of chunks) {
        const linkMatch = chunk.match(/<div class="tg-channel__link"[^>]*>\s*<a href="(\/join\/\d+)"[^>]*>([\s\S]*?)<\/a>/i);
        if (!linkMatch) continue;

        const joinPath = linkMatch[1];
        const title = stripTags(linkMatch[2]);
        const subsMatch = chunk.match(/<span class="tg-stat__user-count"[^>]*>([\s\S]*?)<\/span>/i);
        const subscribers = subsMatch ? parseCount(subsMatch[1]) : 0;
        const descMatch = chunk.match(/<div class="tg-channel__description"[^>]*>([\s\S]*?)<\/div>/i);
        const description = descMatch ? stripTags(descMatch[1]) : '';

        results.push({
            joinPath,
            title,
            subscribers,
            description,
        });
    }

    return results;
}

// Extract exact @username from tgramsearch.com/join/<id> header
export function parseTgramResolveHandle(html) {
    if (!html || typeof html !== 'string') return null;
    const headerMatch = html.match(/<h1 class="tg-channel__header"[^>]*>[\s\S]*?<a[^>]*href="(?:tg:\/\/resolve\?domain=|https?:\/\/t\.me\/)([a-zA-Z0-9_]{3,64})/i);
    if (headerMatch) return headerMatch[1];

    const fallbackMatch = html.match(/<div class="tg-channel__link"[\s\S]{0,400}tg:\/\/resolve\?domain=([a-zA-Z0-9_]{3,64})/i);
    return fallbackMatch ? fallbackMatch[1] : null;
}

// Parse JSON results from combot.org/api/chart/all
export function parseCombotResults(data) {
    if (!Array.isArray(data)) return [];
    return data
        .filter((item) => item && typeof item.u === 'string' && /^[a-zA-Z0-9_]{3,64}$/.test(item.u))
        .map((item) => ({
            username: item.u,
            title: typeof item.t === 'string' ? item.t.trim() : item.u,
            subscribers: typeof item.s === 'number' ? item.s : parseCount(item.s),
            language: typeof item.l === 'string' ? item.l : undefined,
        }));
}
