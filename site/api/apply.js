// Vercel serverless function backing the "Get Started" apply form.
// Reads the Resend API key from the RESEND_API_KEY environment variable (set in
// Vercel Project Settings -> Environment Variables -- never hardcode it here, this
// file is deployed source and could otherwise leak the key).
// Sends from apply@badbunnymgmt.com, which requires badbunnymgmt.com to be added
// and verified as a sending domain in the Resend dashboard (Domains -> Add Domain,
// then add the DKIM/SPF DNS records at Hostinger, same place the site's A/CNAME
// records already live). Until that's verified, Resend will reject the send and
// this function returns a 502 -- it will not silently pretend to succeed.

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const { name, email, of_nickname, twitter, instagram, tiktok, experience, message } = body;

  if (!email || !message) {
    return res.status(400).json({ error: 'Email and message are required.' });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not set');
    return res.status(500).json({ error: 'Email is not configured yet.' });
  }

  const experienceLabel = experience === 'looking_to_start'
    ? 'Looking to start'
    : experience === 'already_started'
      ? 'Already started'
      : '—';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;">
      <h2 style="margin-bottom:4px;">New Application — BadBunnyMGMT</h2>
      <p style="color:#666;margin-top:0;">Submitted via badbunnymgmt.com/get-started.html</p>
      <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;">
        <tr><td><strong>Name</strong></td><td>${escapeHtml(name || '—')}</td></tr>
        <tr><td><strong>Email</strong></td><td>${escapeHtml(email)}</td></tr>
        <tr><td><strong>OnlyFans Nickname</strong></td><td>${escapeHtml(of_nickname || '—')}</td></tr>
        <tr><td><strong>Twitter</strong></td><td>${escapeHtml(twitter || '—')}</td></tr>
        <tr><td><strong>Instagram</strong></td><td>${escapeHtml(instagram || '—')}</td></tr>
        <tr><td><strong>TikTok</strong></td><td>${escapeHtml(tiktok || '—')}</td></tr>
        <tr><td><strong>Experience</strong></td><td>${escapeHtml(experienceLabel)}</td></tr>
      </table>
      <p><strong>Message</strong></p>
      <p style="white-space:pre-wrap;">${escapeHtml(message)}</p>
    </div>
  `;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'BadBunnyMGMT Applications <apply@badbunnymgmt.com>',
        to: ['badbunnymgmt@outlook.com'],
        reply_to: email,
        subject: `New Application — ${name || email}`,
        html,
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      console.error('Resend send failed:', data);
      return res.status(502).json({ error: 'Could not send right now, please try again shortly.' });
    }

    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    console.error('Apply form send error:', err);
    return res.status(500).json({ error: 'Server error, please try again.' });
  }
};
