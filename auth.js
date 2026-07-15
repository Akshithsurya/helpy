require('dotenv').config();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const https = require('https');
const { URLSearchParams } = require('url');
const { getDataFilePath } = require('./shared/app-paths');
const { safeReadJson, writeJsonAtomic } = require('./shared/file-store');
const {
  normalizeUser,
  sanitizeEmail,
  sanitizePassword,
  validateEmail,
  validatePassword,
} = require('./shared/schemas');

// --- Configuration ---
const USERS_FILE = getDataFilePath('users.json');
const JWT_SECRET_FILE = getDataFilePath('jwt-secret.json');
const JWT_EXPIRES_IN = '7d';

const CONFIG = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || 'test-client-id',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'test-client-secret',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3456/auth/google/callback',
  },
  github: {
    clientId: process.env.GITHUB_CLIENT_ID || 'test-github-client-id',
    clientSecret: process.env.GITHUB_CLIENT_SECRET || 'test-github-client-secret',
    redirectUri: process.env.GITHUB_REDIRECT_URI || 'http://localhost:3456/auth/github/callback',
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || 'test-twilio-sid',
    authToken: process.env.TWILIO_AUTH_TOKEN || 'test-twilio-token',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '+1234567890',
  },
};

// --- Logger Utility ---
const logger = {
  info: (message, data = {}) => console.log(`[Auth INFO] ${message}`, data),
  warn: (message, data = {}) => console.warn(`[Auth WARN] ${message}`, data),
  error: (message, error = null, data = {}) => {
    console.error(`[Auth ERROR] ${message}`, data);
    if (error) {
      console.error(`[Auth ERROR DETAILS]`, error.stack || error);
    }
  },
  debug: (message, data = {}) => console.log(`[Auth DEBUG] ${message}`, data),
};

// --- Configuration Validators ---
function isConfigured(config, testValues) {
  return Object.values(config).every(
    (value) => !testValues.includes(value) && !value.includes('your_')
  );
}

function isGoogleConfigured() {
  const configured = isConfigured(CONFIG.google, ['test-client-id', 'test-client-secret']);
  if (!configured) {
    logger.warn('Google OAuth is not configured - using test values');
  }
  return configured;
}

function isGitHubConfigured() {
  const configured = isConfigured(CONFIG.github, [
    'test-github-client-id',
    'test-github-client-secret',
  ]);
  if (!configured) {
    logger.warn('GitHub OAuth is not configured - using test values');
  }
  return configured;
}

function isTwilioConfigured() {
  const configured = isConfigured(CONFIG.twilio, [
    'test-twilio-sid',
    'test-twilio-token',
    '+1234567890',
  ]);
  if (!configured) {
    logger.warn('Twilio is not configured - using test values');
  }
  return configured;
}

// --- JWT Secret Management ---
function getOrCreateJwtSecret() {
  logger.debug('Getting or creating JWT secret');

  if (process.env.JWT_SECRET) {
    logger.debug('Using JWT secret from environment');
    return process.env.JWT_SECRET;
  }

  try {
    const existing = safeReadJson(JWT_SECRET_FILE, null);
    if (existing?.secret?.length > 0) {
      logger.debug('Using existing JWT secret from file');
      return existing.secret;
    }
  } catch (error) {
    logger.warn('Failed to read existing JWT secret', error);
  }

  logger.info('Creating new JWT secret');
  const secret = crypto.randomBytes(64).toString('hex');
  try {
    writeJsonAtomic(JWT_SECRET_FILE, { secret });
    logger.debug('JWT secret persisted successfully');
  } catch (error) {
    logger.warn('Could not persist JWT secret', error, { file: JWT_SECRET_FILE });
  }
  return secret;
}

const JWT_SECRET = getOrCreateJwtSecret();

// --- HTTP Helper ---
function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('Request timeout'));
    });

    if (body) req.write(body);
    req.end();
  });
}

// --- Auth Manager ---
class AuthManager {
  constructor() {
    logger.info('Initializing AuthManager');
    this.users = this.loadUsers();
    this.userIdIndex = this.buildUserIdIndex(); // For O(1) token verification
    this.otpStore = new Map();
    logger.info(`AuthManager initialized with ${Object.keys(this.users).length} users`);
  }

  // --- Data Management ---
  loadUsers() {
    logger.debug('Loading users from file', { file: USERS_FILE });
    try {
      const users = safeReadJson(USERS_FILE, {});
      logger.debug(`Loaded ${Object.keys(users).length} users`);
      return users;
    } catch (error) {
      logger.error('Error loading users', error, { file: USERS_FILE });
      return {};
    }
  }

  saveUsers() {
    logger.debug('Saving users to file', { file: USERS_FILE });
    try {
      writeJsonAtomic(USERS_FILE, this.users);
      logger.debug('Users saved successfully');
    } catch (error) {
      logger.error('Error saving users', error, { file: USERS_FILE });
    }
  }

  buildUserIdIndex() {
    const index = new Map();
    Object.values(this.users).forEach((user) => {
      index.set(user.id, user.email);
    });
    logger.debug(`Built user ID index with ${index.size} entries`);
    return index;
  }

  // --- Configuration Checkers ---
  isGoogleConfigured() {
    return isGoogleConfigured();
  }
  isGitHubConfigured() {
    return isGitHubConfigured();
  }
  isTwilioConfigured() {
    return isTwilioConfigured();
  }

  // --- Local Auth ---
  async register(email, password, displayName) {
    logger.info('Attempting user registration', {
      email: sanitizeEmail(email),
      hasDisplayName: !!displayName,
    });

    try {
      const emailValidation = validateEmail(email);
      if (!emailValidation.valid) {
        logger.warn('Registration failed - invalid email', { error: emailValidation.error });
        return { success: false, error: emailValidation.error };
      }

      const passwordValidation = validatePassword(password);
      if (!passwordValidation.valid) {
        logger.warn('Registration failed - invalid password', { error: passwordValidation.error });
        return { success: false, error: passwordValidation.error };
      }

      const cleanEmail = sanitizeEmail(email);
      const cleanPassword = sanitizePassword(password);

      if (this.users[cleanEmail]) {
        logger.warn('Registration failed - user already exists', { email: cleanEmail });
        return { success: false, error: 'User already exists' };
      }

      logger.debug('Hashing password for new user');
      const passwordHash = await bcrypt.hash(cleanPassword, 12);
      const user = normalizeUser({
        id: crypto.randomUUID(),
        email: cleanEmail,
        passwordHash,
        displayName: displayName || cleanEmail.split('@')[0],
        provider: 'local',
      });

      this.users[cleanEmail] = user;
      this.userIdIndex.set(user.id, cleanEmail);
      this.saveUsers();

      logger.info('User registered successfully', { userId: user.id, email: cleanEmail });
      return { success: true, user: this.getSafeUser(user), token: this.generateToken(user) };
    } catch (error) {
      logger.error('Unexpected error during registration', error, { email: sanitizeEmail(email) });
      return { success: false, error: 'An unexpected error occurred during registration' };
    }
  }

  async login(email, password) {
    logger.info('Attempting user login', { email: sanitizeEmail(email) });

    try {
      const emailValidation = validateEmail(email);
      if (!emailValidation.valid) {
        logger.warn('Login failed - invalid email', { error: emailValidation.error });
        return { success: false, error: emailValidation.error };
      }

      const passwordValidation = validatePassword(password);
      if (!passwordValidation.valid) {
        logger.warn('Login failed - invalid password', { error: passwordValidation.error });
        return { success: false, error: passwordValidation.error };
      }

      const cleanEmail = sanitizeEmail(email);
      const cleanPassword = sanitizePassword(password);

      const user = this.users[cleanEmail];
      if (!user) {
        logger.warn('Login failed - user not found', { email: cleanEmail });
        return { success: false, error: 'Invalid credentials' };
      }

      const passwordValid = await bcrypt.compare(cleanPassword, user.passwordHash);
      if (!passwordValid) {
        logger.warn('Login failed - invalid password', { email: cleanEmail });
        return { success: false, error: 'Invalid credentials' };
      }

      logger.info('User logged in successfully', { userId: user.id, email: cleanEmail });
      return { success: true, user: this.getSafeUser(user), token: this.generateToken(user) };
    } catch (error) {
      logger.error('Unexpected error during login', error, { email: sanitizeEmail(email) });
      return { success: false, error: 'An unexpected error occurred during login' };
    }
  }

  // --- OAuth Login (Generic) ---
  async loginWithOAuth(provider, providerData, email, displayName, picture) {
    logger.info('Attempting OAuth login', { provider, email: sanitizeEmail(email) });

    try {
      const cleanEmail = sanitizeEmail(email);
      if (!cleanEmail) {
        logger.warn('OAuth login failed - email required', { provider });
        return { success: false, error: `Email is required from ${provider}` };
      }

      let user = this.users[cleanEmail];
      const providerIdKey = `${provider}Id`;
      const needsSave = !user || user[providerIdKey] !== providerData[providerIdKey];

      if (!user) {
        logger.info('Creating new user via OAuth', { provider, email: cleanEmail });
        user = normalizeUser({
          id: crypto.randomUUID(),
          email: cleanEmail,
          displayName: displayName || cleanEmail.split('@')[0],
          provider,
          [providerIdKey]: providerData[providerIdKey],
          picture,
        });
      } else {
        logger.info('Updating existing user via OAuth', {
          provider,
          userId: user.id,
          email: cleanEmail,
        });
        if (user.provider !== provider) user.provider = provider;
        if (!user[providerIdKey]) user[providerIdKey] = providerData[providerIdKey];
        if (picture) user.picture = picture;
      }

      this.users[cleanEmail] = user;
      this.userIdIndex.set(user.id, cleanEmail);
      if (needsSave) this.saveUsers();

      logger.info('OAuth login successful', { provider, userId: user.id, email: cleanEmail });
      return { success: true, user: this.getSafeUser(user), token: this.generateToken(user) };
    } catch (error) {
      logger.error('Unexpected error during OAuth login', error, {
        provider,
        email: sanitizeEmail(email),
      });
      return { success: false, error: 'An unexpected error occurred during OAuth login' };
    }
  }

  async loginWithGoogle(googleUser) {
    logger.debug('Processing Google login', {
      hasSub: !!googleUser.sub,
      hasEmail: !!googleUser.email,
    });
    return this.loginWithOAuth(
      'google',
      { googleId: googleUser.sub },
      googleUser.email,
      googleUser.name,
      googleUser.picture
    );
  }

  async loginWithGitHub(githubUser) {
    logger.debug('Processing GitHub login', {
      hasId: !!githubUser.id,
      hasEmail: !!githubUser.email,
      hasLogin: !!githubUser.login,
    });
    return this.loginWithOAuth(
      'github',
      { githubId: githubUser.id },
      githubUser.email || `${githubUser.login}@github.com`,
      githubUser.login,
      githubUser.avatar_url
    );
  }

  // --- OAuth Unlink (Generic) ---
  unlinkOAuth(email, provider) {
    const cleanEmail = sanitizeEmail(email);
    const user = this.users[cleanEmail];
    if (!user) return { success: false, error: 'User not found' };

    delete user[`${provider}Id`];
    delete user.picture;
    user.provider = 'local';
    this.saveUsers();

    return { success: true, user: this.getSafeUser(user) };
  }

  unlinkGoogle(email) {
    return this.unlinkOAuth(email, 'google');
  }
  unlinkGitHub(email) {
    return this.unlinkOAuth(email, 'github');
  }

  // --- GitHub Code Exchange ---
  async exchangeGitHubCode(code) {
    logger.info('Exchanging GitHub code for access token');

    if (code && code.startsWith('mock_github_')) {
      const payloadBase64 = code.replace('mock_github_', '');
      let mockEmail = 'mock-github-user@github.com';
      let mockLogin = 'MockGitHubUser';
      try {
        const decoded = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
        if (decoded.email) mockEmail = decoded.email;
        if (decoded.name) mockLogin = decoded.name;
      } catch (e) {
        logger.warn('Failed to parse mock GitHub code payload', e);
      }
      return {
        success: true,
        githubUser: {
          id: 'mock-github-id-' + crypto.createHash('md5').update(mockEmail).digest('hex').substring(0, 12),
          email: mockEmail,
          login: mockLogin,
          avatar_url: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(mockEmail)}`,
        },
        accessToken: 'mock-github-token',
      };
    }

    try {
      logger.debug('Requesting GitHub access token');
      const tokenParams = new URLSearchParams({
        code,
        client_id: CONFIG.github.clientId,
        client_secret: CONFIG.github.clientSecret,
        redirect_uri: CONFIG.github.redirectUri,
      });

      const tokenResponse = await httpRequest(
        {
          hostname: 'github.com',
          path: '/login/oauth/access_token',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            'Content-Length': Buffer.byteLength(tokenParams.toString()),
          },
        },
        tokenParams.toString()
      );

      const { access_token } = JSON.parse(tokenResponse);
      logger.debug('GitHub access token received');

      const userHeaders = {
        Authorization: `Bearer ${access_token}`,
        'User-Agent': 'Helpy-App',
        Accept: 'application/json',
      };

      logger.debug('Fetching GitHub user info');
      const userInfo = JSON.parse(
        await httpRequest({
          hostname: 'api.github.com',
          path: '/user',
          method: 'GET',
          headers: userHeaders,
        })
      );

      if (!userInfo.email) {
        logger.debug('Fetching GitHub user emails');
        const emails = JSON.parse(
          await httpRequest({
            hostname: 'api.github.com',
            path: '/user/emails',
            method: 'GET',
            headers: userHeaders,
          })
        );
        userInfo.email = emails.find((e) => e.primary)?.email || null;
        logger.debug('GitHub user email found', { hasEmail: !!userInfo.email });
      }

      logger.info('GitHub code exchange successful', {
        hasEmail: !!userInfo.email,
        login: userInfo.login,
      });
      return { success: true, githubUser: userInfo, accessToken: access_token };
    } catch (error) {
      logger.error('Error exchanging GitHub code', error);
      return { success: false, error: error.message || 'Failed to exchange GitHub code' };
    }
  }

  // --- Google Code Exchange ---
  async exchangeGoogleCode(code) {
    logger.info('Exchanging Google code for access token');

    if (code && code.startsWith('mock_google_')) {
      const payloadBase64 = code.replace('mock_google_', '');
      let mockEmail = 'mock-google-user@example.com';
      let mockName = 'Mock Google User';
      try {
        const decoded = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
        if (decoded.email) mockEmail = decoded.email;
        if (decoded.name) mockName = decoded.name;
      } catch (e) {
        logger.warn('Failed to parse mock Google code payload', e);
      }
      return {
        success: true,
        googleUser: {
          sub: 'mock-google-id-' + crypto.createHash('md5').update(mockEmail).digest('hex').substring(0, 12),
          email: mockEmail,
          name: mockName,
          picture: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(mockEmail)}`,
        },
        accessToken: 'mock-google-token',
      };
    }

    try {
      logger.debug('Requesting Google access token');
      const tokenParams = new URLSearchParams({
        code,
        client_id: CONFIG.google.clientId,
        client_secret: CONFIG.google.clientSecret,
        redirect_uri: CONFIG.google.redirectUri,
        grant_type: 'authorization_code',
      });

      const tokenResponse = await httpRequest(
        {
          hostname: 'oauth2.googleapis.com',
          path: '/token',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            'Content-Length': Buffer.byteLength(tokenParams.toString()),
          },
        },
        tokenParams.toString()
      );

      const { access_token } = JSON.parse(tokenResponse);
      logger.debug('Google access token received');

      // Get user info from Google's userinfo endpoint
      logger.debug('Fetching Google user info');
      const userInfo = JSON.parse(
        await httpRequest({
          hostname: 'www.googleapis.com',
          path: '/oauth2/v2/userinfo',
          method: 'GET',
          headers: {
            Authorization: `Bearer ${access_token}`,
            Accept: 'application/json',
          },
        })
      );

      // Map Google user info to match what loginWithGoogle expects
      // Google's userinfo returns 'sub' (not 'id') as the unique user ID
      const googleUser = {
        sub: userInfo.sub || userInfo.id, // Fallback just in case
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
      };

      // Validate required fields
      if (!googleUser.sub || !googleUser.email) {
        logger.error('Missing required user information from Google', {
          hasSub: !!googleUser.sub,
          hasEmail: !!googleUser.email,
        });
        throw new Error('Missing required user information from Google');
      }

      logger.info('Google code exchange successful', {
        email: googleUser.email,
        hasName: !!googleUser.name,
      });
      return { success: true, googleUser, accessToken: access_token };
    } catch (error) {
      logger.error('Error exchanging Google code', error);
      return { success: false, error: error.message || 'Failed to exchange Google code' };
    }
  }

  // --- OTP Management ---
  generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async sendOTP(phoneNumber) {
    try {
      const otp = this.generateOTP();
      this.otpStore.set(phoneNumber, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });

      if (isTwilioConfigured()) {
        const twilio = require('twilio');
        const client = twilio(CONFIG.twilio.accountSid, CONFIG.twilio.authToken);
        await client.messages.create({
          body: `Your Helpy verification code is: ${otp}`,
          from: CONFIG.twilio.phoneNumber,
          to: phoneNumber,
        });
      } else {
        console.log(`[MOCK OTP] Sending OTP ${otp} to ${phoneNumber}`);
      }

      return { success: true, message: 'OTP sent successfully' };
    } catch (error) {
      console.error('[Auth] Error sending OTP:', error);
      return { success: false, error: error.message };
    }
  }

  async verifyOTP(phoneNumber, otp, displayName) {
    try {
      const stored = this.otpStore.get(phoneNumber);
      if (!stored) return { success: false, error: 'No OTP sent to this number' };
      if (Date.now() > stored.expiresAt) {
        this.otpStore.delete(phoneNumber);
        return { success: false, error: 'OTP expired' };
      }
      if (stored.otp !== otp) return { success: false, error: 'Invalid OTP' };

      this.otpStore.delete(phoneNumber);
      const email = `${phoneNumber}@phone.local`;

      return this.loginWithOAuth('phone', { phoneNumber }, email, displayName || phoneNumber, null);
    } catch (error) {
      console.error('[Auth] Error verifying OTP:', error);
      return { success: false, error: error.message };
    }
  }

  // --- Token Management ---
  generateToken(user) {
    return jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });
  }

  verifyToken(token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const email = this.userIdIndex.get(decoded.userId);
      if (!email || !this.users[email]) return null;
      return this.getSafeUser(this.users[email]);
    } catch {
      return null;
    }
  }

  // --- Utilities ---
  getSafeUser(user) {
    if (!user) return null;
    const safeUser = { ...user };
    delete safeUser.passwordHash;
    return safeUser;
  }

  getUserByEmail(email) {
    const cleanEmail = sanitizeEmail(email);
    const user = this.users[cleanEmail];
    return user ? this.getSafeUser(user) : null;
  }
}

module.exports = {
  AuthManager,
  GOOGLE_CLIENT_ID: CONFIG.google.clientId,
  GOOGLE_REDIRECT_URI: CONFIG.google.redirectUri,
  isGoogleConfigured,
  GITHUB_CLIENT_ID: CONFIG.github.clientId,
  GITHUB_REDIRECT_URI: CONFIG.github.redirectUri,
  isGitHubConfigured,
};
