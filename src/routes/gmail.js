const express = require('express');
const router = express.Router();
const gmailService = require('../services/gmailService');
const syncService = require('../services/syncService');
const GmailAccount = require('../models/GmailAccount');
const config = require('../config/env');

// GET /api/gmail/connect
router.get('/connect', (req, res) => {
  try {
    const { url } = gmailService.getAuthUrl();
    res.json({ url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/gmail/callback
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(`${config.FRONTEND_URL}/gmail?error=${encodeURIComponent(error)}`);
    }

    if (!code) {
      return res.redirect(`${config.FRONTEND_URL}/gmail?error=Missing_authorization_code`);
    }

    const account = await gmailService.handleOAuthCallback(code, state);
    res.redirect(`${config.FRONTEND_URL}/gmail?success=true&email=${encodeURIComponent(account.email)}`);
  } catch (err) {
    console.error('[Gmail Callback] Error:', err.message);
    res.redirect(`${config.FRONTEND_URL}/gmail?error=${encodeURIComponent(err.message)}`);
  }
});

// GET /api/gmail/status
router.get('/status', async (req, res) => {
  try {
    const account = await GmailAccount.findOne().sort({ connectedAt: -1 });
    if (!account) {
      return res.json({ connected: false });
    }

    res.json({
      connected: true,
      email: account.email,
      connectedAt: account.connectedAt,
      scope: account.scope,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/gmail/disconnect
router.post('/disconnect', async (req, res) => {
  try {
    await GmailAccount.deleteMany({});
    res.json({ message: 'Gmail account disconnected successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/gmail/sync (Manual sync trigger)
router.post('/sync', async (req, res) => {
  try {
    await syncService.syncAllPendingReplies();
    res.json({ message: 'Reply synchronization completed successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/gmail/test-send (Verify sending with real Gmail API)
router.post('/test-send', async (req, res) => {
  try {
    const { recipientEmail } = req.body;
    const account = await GmailAccount.findOne().sort({ connectedAt: -1 });
    if (!account) {
      return res.status(400).json({ error: 'No Gmail account connected.' });
    }

    const targetEmail = recipientEmail || account.email;

    const result = await gmailService.sendGmailEmail({
      to: targetEmail,
      subject: 'Test Email from Antigravity Mailer',
      body: `Hello!\n\nThis is a test email sent via your connected Gmail account (${account.email}) to verify the Gmail API outreach setup.\n\nEverything is working smoothly!`,
    });

    res.json({
      message: `Test email sent successfully to ${targetEmail}`,
      result,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

