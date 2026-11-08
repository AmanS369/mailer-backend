const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const fs = require('fs');
const crypto = require('crypto');
const config = require('../config/env');
const cryptoService = require('./cryptoService');
const GmailAccount = require('../models/GmailAccount');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

/**
 * In-memory state store for CSRF protection during OAuth
 */
const oauthStates = new Map();

/**
 * Create a new OAuth2 client instance
 */
function createOAuth2Client() {
  return new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    config.GOOGLE_REDIRECT_URI
  );
}

/**
 * Generate Google OAuth authorization URL
 */
function getAuthUrl() {
  const oauth2Client = createOAuth2Client();
  const state = crypto.randomBytes(24).toString('hex');
  oauthStates.set(state, { createdAt: Date.now() });

  // Clean old states > 15 mins
  const now = Date.now();
  for (const [key, val] of oauthStates.entries()) {
    if (now - val.createdAt > 15 * 60 * 1000) {
      oauthStates.delete(key);
    }
  }

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });

  return { url, state };
}

/**
 * Exchange auth code for tokens and save account
 */
async function handleOAuthCallback(code, state) {
  if (!state || !oauthStates.has(state)) {
    throw new Error('Invalid or expired OAuth state parameter (CSRF check failed).');
  }
  oauthStates.delete(state);

  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Get user profile email
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();
  const userEmail = userInfo.data.email ? userInfo.data.email.toLowerCase().trim() : '';

  if (!userEmail) {
    throw new Error('Unable to retrieve user email from Google.');
  }

  // Get initial Gmail historyId
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  let historyId = null;
  try {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    historyId = profile.data.historyId || null;
  } catch (err) {
    console.warn('[Gmail] Could not get initial profile historyId:', err.message);
  }

  let encryptedRefreshToken = '';
  if (tokens.refresh_token) {
    encryptedRefreshToken = cryptoService.encrypt(tokens.refresh_token);
  } else {
    // If Google didn't return a new refresh token, retain existing if available
    const existing = await GmailAccount.findOne({ email: userEmail });
    if (existing && existing.encryptedRefreshToken) {
      encryptedRefreshToken = existing.encryptedRefreshToken;
    } else {
      throw new Error('No refresh token received from Google. Please reconnect with consent prompt.');
    }
  }

  const account = await GmailAccount.findOneAndUpdate(
    { email: userEmail },
    {
      email: userEmail,
      googleId: userInfo.data.id || '',
      encryptedRefreshToken,
      accessToken: tokens.access_token || '',
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      historyId,
      scope: tokens.scope || SCOPES.join(' '),
      connectedAt: new Date(),
    },
    { upsert: true, new: true }
  );

  return account;
}

/**
 * Get authenticated OAuth2 client for the connected account
 */
async function getAuthenticatedClient() {
  const account = await GmailAccount.findOne().sort({ connectedAt: -1 });
  if (!account) {
    throw new Error('No connected Gmail account found. Please connect your Gmail account in Settings.');
  }

  const refreshToken = cryptoService.decrypt(account.encryptedRefreshToken);
  if (!refreshToken) {
    throw new Error('Connected Gmail account is missing a valid refresh token.');
  }

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    refresh_token: refreshToken,
    access_token: account.accessToken,
  });

  // Listen for automatic token refreshes
  oauth2Client.on('tokens', async (newTokens) => {
    try {
      const updateData = {};
      if (newTokens.access_token) updateData.accessToken = newTokens.access_token;
      if (newTokens.expiry_date) updateData.tokenExpiry = new Date(newTokens.expiry_date);
      if (newTokens.refresh_token) {
        updateData.encryptedRefreshToken = cryptoService.encrypt(newTokens.refresh_token);
      }
      await GmailAccount.findByIdAndUpdate(account._id, updateData);
    } catch (err) {
      console.error('[Gmail] Error saving updated tokens:', err.message);
    }
  });

  return { oauth2Client, account };
}

/**
 * Construct safe RFC 5322/2047 sender object for Nodemailer
 * Preserves the authenticated Gmail address and adds display name if configured.
 * @param {string} displayName - Optional sender display name (e.g. "Aman Singh")
 * @param {string} emailAddress - Authenticated Gmail address
 * @returns {object|string}
 */
function buildSenderAddress(displayName, emailAddress) {
  if (!emailAddress) {
    throw new Error('Authenticated email address is required to construct From header.');
  }
  const cleanName = (displayName || '').trim();
  if (!cleanName) {
    return emailAddress;
  }
  return {
    name: cleanName,
    address: emailAddress,
  };
}

/**
 * Send an email using Gmail API
 * Supports attachments and thread reply chaining (In-Reply-To, References)
 */
async function sendGmailEmail({
  to,
  subject,
  body,
  attachmentPath,
  attachmentName,
  threadId,
  inReplyTo,
  references,
  senderName,
}) {
  const { oauth2Client, account } = await getAuthenticatedClient();
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Resolve sender display name: caller parameter > GMAIL_SENDER_NAME environment variable
  const resolvedDisplayName = (senderName || config.GMAIL_SENDER_NAME || '').trim();
  const fromHeader = buildSenderAddress(resolvedDisplayName, account.email);

  // Use nodemailer MailComposer to construct valid MIME message
  const mailOptions = {
    from: fromHeader,
    to,
    subject,
    text: body,
  };

  // If in-reply-to or references exist (for follow-ups in the same thread)
  if (inReplyTo) {
    mailOptions.inReplyTo = inReplyTo;
    mailOptions.references = references || inReplyTo;
  }

  // Handle PDF attachment
  if (attachmentPath) {
    if (!fs.existsSync(attachmentPath)) {
      throw new Error(`Attachment file not found at ${attachmentPath}. Refusing to send email without attachment.`);
    }
    mailOptions.attachments = [
      {
        filename: attachmentName || 'Resume.pdf',
        path: attachmentPath,
        contentType: 'application/pdf',
      },
    ];
  }

  const transporter = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
  });

  const message = await transporter.sendMail(mailOptions);
  const rawBase64 = Buffer.from(message.message)
    .toString('base64url');

  const requestBody = { raw: rawBase64 };
  if (threadId) {
    requestBody.threadId = threadId;
  }

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody,
  });

  return {
    gmailMessageId: response.data.id,
    gmailThreadId: response.data.threadId,
    senderEmail: account.email,
  };
}

/**
 * Fetch thread details to check for replies or message headers
 */
async function getThreadDetails(threadId) {
  const { oauth2Client } = await getAuthenticatedClient();
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const res = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  });

  return res.data;
}

/**
 * Fetch a specific message by ID
 */
async function getMessageDetails(messageId) {
  const { oauth2Client } = await getAuthenticatedClient();
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  return res.data;
}

module.exports = {
  getAuthUrl,
  handleOAuthCallback,
  getAuthenticatedClient,
  sendGmailEmail,
  buildSenderAddress,
  getThreadDetails,
  getMessageDetails,
};

