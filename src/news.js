'use strict';

const config = require('./config');
const { fetchJson, fetchText } = require('./helpers');

function decode(value) {
    return String(value || '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&#x27;/g, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tagText(block, tag) {
    const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return match ? decode(match[1]) : '';
}

function tagAttr(block, tag) {
    const match = block.match(new RegExp(`<${tag}\\b[^>]*\\burl=["']([^"']+)["']`, 'i'));
    return match ? match[1] : '';
}

function parseRss(xml, limit, sourceName) {
    const blocks = [...String(xml).matchAll(/<item\b[\s\S]*?<\/item>/gi)].slice(0, limit);
    return blocks.map((match) => {
        const block = match[0];
        const link = tagText(block, 'link') || tagAttr(block, 'link');
        const image = tagAttr(block, 'media:thumbnail') ||
            tagAttr(block, 'media:content') ||
            tagAttr(block, 'enclosure') ||
            tagAttr(block, 'thumbnail');
        return {
            title: tagText(block, 'title'),
            description: tagText(block, 'description').slice(0, 280),
            url: link,
            image,
            source: tagText(block, 'source') || sourceName,
            publishedAt: tagText(block, 'pubDate'),
        };
    }).filter((article) => article.title && article.url);
}

async function fromGnews(category, limit) {
    const key = config.newsApiKey;
    if (!key) return [];
    const url = `https://gnews.io/api/v4/top-headlines?category=${encodeURIComponent(category)}&lang=en&max=${Math.min(limit, 10)}&apikey=${key}`;
    const data = await fetchJson(url, {}, 20_000);
    return (data.articles || []).map((article) => ({
        title: article.title || '',
        description: String(article.description || '').slice(0, 280),
        url: article.url || '',
        image: article.image || '',
        source: article.source?.name || 'GNews',
        publishedAt: article.publishedAt || '',
    })).filter((article) => article.title && article.url);
}

const FEEDS = {
    world: [
        { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', source: 'BBC World' },
        { url: 'https://www.aljazeera.com/xml/rss/all.xml', source: 'Al Jazeera' },
    ],
    technology: [
        { url: 'https://www.engadget.com/rss.xml', source: 'Engadget' },
        { url: 'https://www.wired.com/feed/rss', source: 'Wired' },
    ],
};

async function fromFeeds(category, limit) {
    for (const feed of FEEDS[category] || []) {
        try {
            const xml = await fetchText(feed.url, {
                headers: { 'User-Agent': 'Cortana-Mini/2.3', Accept: 'application/rss+xml, application/xml, text/xml' },
            }, 20_000);
            const articles = parseRss(xml, limit, feed.source);
            if (articles.length) return articles;
        } catch { /* try the next feed */ }
    }
    return [];
}

async function fetchWorldNews(limit = 5) {
    try {
        const viaApi = await fromGnews('world', limit);
        if (viaApi.length) return viaApi;
    } catch { /* fall back to RSS */ }
    return fromFeeds('world', limit);
}

async function fetchTechNews(limit = 5) {
    try {
        const viaApi = await fromGnews('technology', limit);
        if (viaApi.length) return viaApi;
    } catch { /* fall back to RSS */ }
    return fromFeeds('technology', limit);
}

function formatPublished(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

module.exports = { fetchWorldNews, fetchTechNews, formatPublished, parseRss };
