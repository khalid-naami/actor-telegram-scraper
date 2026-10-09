# ✈️ Telegram Ultimate Scraper & Channel Finder (Channels, Posts, Media, Views & Reactions)

Comprehensive, login-free Telegram data extraction and channel discovery engine on Apify. Extract **Public Channels** (subscriber counts, descriptions, verified badges), **Posts & Messages** (full text, timestamps, views count, reactions breakdown, forwards count), **Media Files** (photos, videos), and **Channel Finder by Keyword** without needing a Telegram login or phone number.

---

## ⚡ Key Features

- 📢 **Zero Login Required**: Scrapes public Telegram channels and post histories via public web gateways without requiring a Telegram phone number or account session.
- 💬 **Complete Post & Message Data**: Extract full message content (with formatted line breaks and links), message ID, publication timestamp, views count, and forward counts.
- ❤️ **Reactions Breakdown**: Extracts all emoji reactions and their individual counts (`👍`, `🔥`, `❤️`, `🎉`, etc.).
- 🖼️ **Media Attachments**: Direct CDN links to high-resolution photos, video files, audio clips, and documents.
- 👥 **Channel Intelligence**: Extract subscriber counts, channel bios, avatar URLs, and official verified badges.
- 🔍 **Automated Channel Finder**: Search and discover public Telegram channels by keyword, niche, or topic (e.g., *crypto trading signals*, *artificial intelligence*, *dropshipping deals*).
- 📧 **Direct Lead Generation**: Automatically extracts business contact emails, phone numbers, and external websites found in channel bios or messages.
- 🛡️ **Dual-Engine Architecture**: Blazing fast HTTP requests via `got-scraping` paired with an intelligent Playwright browser fallback.

---

## 📥 Input Configuration

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `mode` | String | `AUTO_DETECT` | Extraction mode: `AUTO_DETECT`, `CHANNELS`, `POSTS`, `CHANNEL_FINDER`. |
| `targetUrls` | Array | `[...]` | Public Telegram channel links (e.g., `https://t.me/s/durov`, `https://t.me/telegram`). |
| `searchKeywords` | Array | `[]` | Keywords to discover public Telegram channels across the web. |
| `maxPosts` | Integer | `50` | Maximum messages to extract per channel. |
| `maxItems` | Integer | `30` | Maximum channels or discovery items to process. |
| `proxyConfiguration` | Object | `{ useApifyProxy: true }` | Apify Residential proxy configuration (recommended). |

---

## 📤 Output Data Format

### 1. Telegram Channel Record

```json
{
  "type": "CHANNEL",
  "id": "durov",
  "url": "https://t.me/durov",
  "previewUrl": "https://t.me/s/durov",
  "channelName": "Pavel Durov",
  "channelUsername": "@durov",
  "channelDescription": "Thoughts from the founder of Telegram.",
  "subscribersCount": "2.8M subscribers",
  "subscribersCountRaw": 2800000,
  "avatarUrl": "https://cdn4.cdn-telegram.org/...",
  "isVerified": true,
  "scrapedAt": "2026-10-09T13:10:00.000Z"
}
```

### 2. Telegram Post Record with Reactions

```json
{
  "type": "POST",
  "id": "durov_342",
  "messageId": 342,
  "url": "https://t.me/durov/342",
  "channelUsername": "@durov",
  "text": "Telegram reached 950 million active users this month. We are on track to pass 1 billion soon.",
  "viewsCount": "1.4M",
  "viewsCountRaw": 1400000,
  "reactions": [
    { "emoji": "🔥", "count": 18200 },
    { "emoji": "👍", "count": 24500 },
    { "emoji": "🎉", "count": 12100 }
  ],
  "mediaType": "photo",
  "photoUrl": "https://cdn4.cdn-telegram.org/...",
  "date": "2026-10-08T15:20:00+00:00",
  "scrapedAt": "2026-10-09T13:10:00.000Z"
}
```

---

## 💼 Business & Lead Generation Use Cases

- **Crypto & Web3 Community Monitoring**: Monitor public announcements, trading signals, and token updates in real time.
- **Niche Channel Prospecting**: Discover high-engagement channels in your sector for sponsorship, partnerships, or PR.
- **Competitor Tracking**: Track follower growth, posting frequency, and average post view counts across competitor channels.

---

## 📄 License
Apache-2.0
