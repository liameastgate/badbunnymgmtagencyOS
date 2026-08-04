// Server-side relay for TikTok/Instagram post previews. Browsers can't call these
// endpoints directly (no permissive CORS headers), so both the Content Orders
// "auto-fetch thumbnail" feature and the Content Performance Meta CSV import route
// through this Vercel serverless function instead.
//
// IMPORTANT: as of Nov 2025 Meta stopped returning thumbnail_url (and author_name) from
// the official /instagram_oembed endpoint entirely -- this is a permanent removal, not a
// bug, confirmed in Meta's own developer docs. Meta's own guidance is to pull the
// thumbnail from the post's Open Graph <meta property="og:image"> tag instead, so that's
// the fallback used below whenever the official API doesn't hand back a thumbnail. This
// is the same technique link-preview features in iMessage/Slack/Discord use for public
// posts, and it's the reason "the thumbnail section doesn't work" was happening -- the
// old code only ever tried the official field, which Meta had already quietly emptied out.
//
// CommonJS on purpose: no package.json exists in this repo, so this avoids relying on
// Vercel's Node runtime defaulting to ESM for a bare .js file.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = req.query.url;
  if (!url || typeof url !== 'string') {
    return res.status(200).json({ ok: false, error: 'missing url' });
  }

  let platform = null;
  if (/instagram\.com/i.test(url)) platform = 'instagram';
  else if (/tiktok\.com/i.test(url)) platform = 'tiktok';
  else {
    return res.status(200).json({ ok: false, error: 'unsupported platform' });
  }

  let thumbnail_url = null, title = null, author_name = null;

  // 1. Try the official oEmbed endpoint first -- still useful for TikTok (unaffected),
  // and harmless to keep in case Meta ever restores the Instagram thumbnail field.
  try {
    const endpoint = platform === 'tiktok'
      ? `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`
      : `https://graph.facebook.com/v22.0/instagram_oembed?url=${encodeURIComponent(url)}`;
    const r = await fetch(endpoint, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (r.ok) {
      const data = await r.json();
      thumbnail_url = data.thumbnail_url || null;
      title = data.title || data.author_name || null;
      author_name = data.author_name || null;
    }
  } catch (e) { /* fall through to og:image scrape below */ }

  // 2. Fallback: read the Open Graph tags straight off the post's own public page.
  if (!thumbnail_url) {
    try {
      const pageRes = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        },
      });
      if (pageRes.ok) {
        const html = await pageRes.text();
        const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
        const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
                      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
        if (ogImage && ogImage[1]) thumbnail_url = ogImage[1].replace(/&amp;/g, '&');
        if (!title && ogTitle && ogTitle[1]) title = ogTitle[1].replace(/&amp;/g, '&');
      }
    } catch (e) { /* leave thumbnail_url null -- caller handles this gracefully */ }
  }

  if (!thumbnail_url && !title) {
    return res.status(200).json({ ok: false, error: 'no_preview_available' });
  }

  return res.status(200).json({
    ok: true,
    platform,
    thumbnail_url,
    title,
    author_name,
  });
};
