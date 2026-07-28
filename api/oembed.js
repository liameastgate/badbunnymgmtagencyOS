// Server-side relay for TikTok/Instagram oEmbed endpoints.
// Browsers can't call these directly (no permissive CORS headers), so the
// Content Orders "auto-fetch thumbnail" feature routes through this Vercel
// serverless function instead. Both endpoints are public/token-free as of
// mid-2026 -- no API keys or scraping involved, just their documented oEmbed API.
// CommonJS on purpose: no package.json exists in this repo, so this avoids
// relying on Vercel's Node runtime defaulting to ESM for a bare .js file.
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

  try {
    const endpoint = platform === 'tiktok'
      ? `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`
      : `https://graph.facebook.com/v25.0/instagram_oembed?url=${encodeURIComponent(url)}`;

    const r = await fetch(endpoint, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return res.status(200).json({ ok: false, error: `oembed_${r.status}` });
    const data = await r.json();
    return res.status(200).json({
      ok: true,
      platform,
      thumbnail_url: data.thumbnail_url || null,
      title: data.title || data.author_name || null,
      author_name: data.author_name || null,
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String((e && e.message) || e) });
  }
};
