/**
 * Telegram Ultimate Scraper - Extractors & Parsers
 * High-speed parsing for Public Telegram Channels, Posts, Reactions, and Media.
 */

// Helper to extract email addresses
export function extractEmails(text) {
    if (!text || typeof text !== 'string') return [];
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    const matches = text.match(emailRegex) || [];
    const ignored = ['telegram.org', 't.me', 'example.com'];
    const unique = [...new Set(matches.map(m => m.trim().toLowerCase()))];
    return unique.filter(e => !ignored.some(d => e.endsWith(`@${d}`)));
}

// Helper to extract phone numbers
export function extractPhones(text) {
    if (!text || typeof text !== 'string') return [];
    const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,5}/g;
    const matches = text.match(phoneRegex) || [];
    const valid = matches
        .map(p => p.trim())
        .filter(p => {
            const digits = p.replace(/\D/g, '');
            return digits.length >= 8 && digits.length <= 15;
        });
    return [...new Set(valid)];
}

// Helper to extract external links
export function extractExternalLinks(text) {
    if (!text || typeof text !== 'string') return [];
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = text.match(urlRegex) || [];
    return [...new Set(matches.filter(u => !u.includes('t.me') && !u.includes('telegram.org')))];
}

// Parse counts like "1.2M", "45.6K", "250"
export function parseCount(str) {
    if (!str) return 0;
    if (typeof str === 'number') return str;
    const text = String(str).trim().toUpperCase();

    let multiplier = 1;
    if (text.includes('M')) multiplier = 1_000_000;
    else if (text.includes('K')) multiplier = 1_000;

    const cleaned = text.replace(/[^0-9.]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : Math.round(num * multiplier);
}

// Parse Channel Header / Metadata from t.me/s/ HTML
export function parseChannelMetadata(html, url) {
    if (!html) return null;

    const usernameMatch = url.match(/t\.me\/(?:s\/)?([a-zA-Z0-9_]+)/i);
    const username = usernameMatch ? usernameMatch[1] : null;

    // Title
    const titleMatch = html.match(/<div class="tgme_page_title"[^>]*>([\s\S]*?)<\/div>/i)
        || html.match(/<meta property="og:title" content="([^"]*)"/i);
    let title = '';
    if (titleMatch) {
        title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
    }

    // Description / Bio
    const descMatch = html.match(/<div class="tgme_page_description"[^>]*>([\s\S]*?)<\/div>/i)
        || html.match(/<meta property="og:description" content="([^"]*)"/i);
    let description = '';
    if (descMatch) {
        description = descMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    // Subscribers
    const subMatch = html.match(/<div class="tgme_page_extra"[^>]*>([\s\S]*?)<\/div>/i);
    let subscribersCount = null;
    let subscribersCountRaw = 0;
    if (subMatch) {
        const text = subMatch[1].replace(/<[^>]+>/g, '').trim();
        subscribersCount = text;
        subscribersCountRaw = parseCount(text);
    }

    // Avatar
    const avatarMatch = html.match(/<img class="tgme_page_photo_image"[^>]*src="([^"]*)"/i)
        || html.match(/<meta property="og:image" content="([^"]*)"/i);
    const avatarUrl = avatarMatch ? avatarMatch[1] : null;

    // Verified
    const isVerified = Boolean(html.includes('tgme_page_verified_badge') || html.includes('verified'));

    const emails = extractEmails(description);
    const phones = extractPhones(description);
    const externalLinks = extractExternalLinks(description);

    return {
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
        email: emails[0] || null,
        emails,
        phone: phones[0] || null,
        phones,
        externalLinks: externalLinks.length > 0 ? externalLinks : undefined,
        scrapedAt: new Date().toISOString()
    };
}

// Parse Channel Posts from t.me/s/ HTML
export function parseChannelPosts(html, maxPosts = 50) {
    if (!html) return [];
    const posts = [];

    // Split messages by wrap
    const messageBlocks = html.split('<div class="tgme_widget_message_wrap');

    for (let i = 1; i < messageBlocks.length; i++) {
        if (posts.length >= maxPosts) break;
        const block = messageBlocks[i];

        // Post data attribute: data-post="username/123"
        const postDataMatch = block.match(/data-post="([a-zA-Z0-9_]+)\/(\d+)"/i);
        if (!postDataMatch) continue;

        const channelUsername = postDataMatch[1];
        const messageId = parseInt(postDataMatch[2], 10);
        const postUrl = `https://t.me/${channelUsername}/${messageId}`;

        // Text
        const textMatch = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        let text = '';
        if (textMatch) {
            text = textMatch[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
        }

        // Date
        const dateMatch = block.match(/<time[^>]*datetime="([^"]*)"[^>]*>/i);
        const date = dateMatch ? dateMatch[1] : null;

        // Views
        const viewsMatch = block.match(/<span class="tgme_widget_message_views"[^>]*>([\s\S]*?)<\/span>/i);
        const viewsText = viewsMatch ? viewsMatch[1].trim() : '0';
        const viewsCountRaw = parseCount(viewsText);

        // Reactions
        const reactions = [];
        const reactionRegex = /<span class="reaction_emoji">([^<]*)<\/span>[\s\S]*?<span class="reaction_count">([^<]*)<\/span>/gi;
        let rMatch;
        while ((rMatch = reactionRegex.exec(block)) !== null) {
            reactions.push({
                emoji: rMatch[1].trim(),
                count: parseCount(rMatch[2])
            });
        }

        // Media
        let mediaType = 'none';
        let photoUrl = null;
        let videoUrl = null;

        // Photo background-image
        const photoMatch = block.match(/class="tgme_widget_message_photo_wrap"[^>]*style="[^"]*background-image:url\('([^']+)'\)/i);
        if (photoMatch) {
            mediaType = 'photo';
            photoUrl = photoMatch[1];
        }

        // Video
        const videoMatch = block.match(/<video[^>]*src="([^"]*)"/i);
        if (videoMatch) {
            mediaType = 'video';
            videoUrl = videoMatch[1];
        } else if (block.includes('tgme_widget_message_video')) {
            mediaType = 'video';
        }

        // Document / Poll
        if (block.includes('tgme_widget_message_document')) mediaType = 'document';
        if (block.includes('tgme_widget_message_poll')) mediaType = 'poll';

        const emails = extractEmails(text);
        const phones = extractPhones(text);
        const externalLinks = extractExternalLinks(text);

        posts.push({
            type: 'POST',
            id: `${channelUsername}_${messageId}`,
            messageId,
            url: postUrl,
            channelUsername: `@${channelUsername}`,
            text,
            viewsCount: viewsText,
            viewsCountRaw,
            reactions: reactions.length > 0 ? reactions : undefined,
            mediaType,
            photoUrl,
            videoUrl,
            externalLinks: externalLinks.length > 0 ? externalLinks : undefined,
            email: emails[0] || null,
            emails: emails.length > 0 ? emails : undefined,
            phone: phones[0] || null,
            phones: phones.length > 0 ? phones : undefined,
            date,
            scrapedAt: new Date().toISOString()
        });
    }

    return posts;
}
