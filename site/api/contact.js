// Vercel serverless function backing the Contact page form. See api/apply.js for the
// full explanation of the RESEND_API_KEY env var + domain verification requirement --
// same setup applies here.

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

  const { name, email, message } = body;

  if (!email || !message) {
    return res.status(400).json({ error: 'Email and message are required.' });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not set');
    return res.status(500).json({ error: 'Email is not configured yet.' });
  }

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;">
      <h2 style="margin-bottom:4px;">New Contact Message — BadBunnyMGMT</h2>
      <p style="color:#666;margin-top:0;">Submitted via badbunnymgmt.com/contact.html</p>
      <p><strong>Name:</strong> ${escapeHtml(name || '—')}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
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
        from: 'BadBunnyMGMT Contact <contact@badbunnymgmt.com>',
        to: ['badbunnymgmt@outlook.com'],
        reply_to: email,
        subject: `New Contact Message — ${name || email}`,
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
    console.error('Contact form send error:', err);
    return res.status(500).json({ error: 'Server error, please try again.' });
  }
};
