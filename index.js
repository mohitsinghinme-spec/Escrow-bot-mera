const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const mongoose = require('mongoose');
const redis = require('redis');
const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// ============ CONFIGURATION ============
const TOKEN = process.env.8744075645:AAHhRg1HHWxPDmGNh8EPAHP2gkB4f9bzvPU;
const GROUP_ID = process.env.GROUP_ID || -1003577641778;
const ADMIN_IDS = (process.env.ADMIN_IDS || "7952793528").split(",").map(Number);
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/escrow-bot";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const JWT_SECRET = process.env.JWT_SECRET || "escrow_jwt_secret_key_2024";

if (!TOKEN) {
  console.error("❌ BOT_TOKEN not found in .env file!");
  process.exit(1);
}

const CRYPTO_PRICES = {
  'USDT': 1,
  'BNB': 600,
  'SOL': 200,
  'USDC': 1
};

const TRANSACTION_FEES = {
  MIN: 1,
  PERCENT: 0.02, // 2%
  MAX: 10
};

// ============ DATABASE CONNECTION ============
mongoose.connect(MONGODB_URI, {
  retryWrites: true
}).then(() => {
  console.log("✅ MongoDB Connected Successfully");
}).catch(err => {
  console.error("❌ MongoDB Connection Error:", err.message);
  process.exit(1);
});

// Redis Connection
const redisClient = redis.createClient({ url: REDIS_URL });
redisClient.on('error', (err) => console.error('🔴 Redis Error:', err));
redisClient.on('connect', () => console.log('✅ Redis Connected'));
redisClient.connect().catch(err => {
  console.error('❌ Redis Connection Error:', err.message);
});

// ============ DATABASE SCHEMAS ============

// Advanced User Schema
const userSchema = new mongoose.Schema({
  telegramId: { type: Number, unique: true, required: true, index: true },
  username: String,
  firstName: String,
  lastName: String,
  phoneNumber: String,
  email: { type: String, sparse: true },
  
  // Wallet & Financial
  walletAddress: String,
  walletNetwork: String, // BSC, SOL, ETH
  totalVolume: { type: Number, default: 0 },
  
  // Reputation System
  reputation: { type: Number, default: 0 },
  successfulDeals: { type: Number, default: 0 },
  cancelledDeals: { type: Number, default: 0 },
  totalEarnings: { type: Number, default: 0 },
  
  // Security
  verificationStatus: { type: String, enum: ['unverified', 'pending', 'verified', 'blocked'], default: 'unverified' },
  kyc: {
    status: { type: String, enum: ['none', 'pending', 'verified', 'rejected'], default: 'none' },
    idNumber: String,
    idType: String,
    verifiedAt: Date,
    expiresAt: Date
  },
  
  // Blocklists & Restrictions
  blockList: [Number],
  trustedUsers: [Number],
  restrictions: {
    maxDealAmount: { type: Number, default: 10000 },
    dailyTransactionLimit: { type: Number, default: 50000 },
    dailyTransactionUsed: { type: Number, default: 0 },
    canTrade: { type: Boolean, default: true }
  },
  
  // Preferences
  preferredCryptos: [String],
  language: { type: String, default: 'en' },
  notificationsEnabled: { type: Boolean, default: true },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now, index: true },
  lastActive: { type: Date, default: Date.now },
  lastLogin: Date,
  
  // References
  posts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Post' }],
  deals: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Deal' }],
  disputes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Dispute' }],
  
  // Statistics
  stats: {
    viewCount: { type: Number, default: 0 },
    interactionCount: { type: Number, default: 0 },
    avgRating: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 }
  }
}, { timestamps: true });

// Advanced Post Schema
const postSchema = new mongoose.Schema({
  postId: { type: String, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  
  // Trade Details
  type: { type: String, enum: ['sell', 'buy'], required: true, index: true },
  crypto: { type: String, required: true, index: true },
  amount: { type: Number, required: true },
  rate: { type: Number, required: true },
  minAmount: { type: Number, default: null },
  maxAmount: { type: Number, default: null },
  
  // Status & Tracking
  status: { type: String, enum: ['active', 'completed', 'expired', 'cancelled', 'held'], default: 'active', index: true },
  views: { type: Number, default: 0 },
  inquiries: { type: Number, default: 0 },
  completedTrades: { type: Number, default: 0 },
  
  // Messages & Reviews
  messageId: Number,
  chatId: Number,
  editHistory: [{
    oldData: Object,
    changedAt: Date
  }],
  reviews: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Review' }],
  avgRating: { type: Number, default: 0 },
  
  // Payment Methods
  paymentMethods: [String],
  
  // Time Limits
  createdAt: { type: Date, default: Date.now, expires: 604800, index: true },
  updatedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(+new Date() + 7*24*60*60*1000) }
}, { timestamps: true });

// Advanced Deal Schema
const dealSchema = new mongoose.Schema({
  dealId: { type: String, unique: true, index: true },
  dealCounter: { type: Number, index: true },
  
  // Parties
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  arbitrator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // Deal Details
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  crypto: String,
  cryptoAmount: Number,
  fiatAmount: { type: Number, required: true },
  exchangeRate: Number,
  
  // Fees & Calculations
  platformFee: {
    amount: Number,
    percentage: Number,
    currency: String
  },
  
  // Timeline
  status: { type: String, enum: ['initiated', 'pending', 'active', 'in_transit', 'completed', 'disputed', 'cancelled', 'refunded'], default: 'initiated', index: true },
  milestone: { type: String, enum: ['pending_payment', 'payment_verified', 'fund_released', 'confirmed'], default: 'pending_payment' },
  
  // Transaction Milestones
  transactions: [{
    transactionId: String,
    from: mongoose.Schema.Types.ObjectId,
    to: mongoose.Schema.Types.ObjectId,
    amount: Number,
    type: { type: String, enum: ['deposit', 'release', 'refund', 'fee'] },
    status: { type: String, enum: ['pending', 'confirmed', 'failed'], default: 'pending' },
    proof: String,
    verifiedBy: mongoose.Schema.Types.ObjectId,
    verifiedAt: Date,
    timestamp: { type: Date, default: Date.now }
  }],
  
  // Dispute & Resolution
  disputeRaised: { type: Boolean, default: false },
  disputeReason: String,
  disputeEvidence: [String],
  resolution: {
    status: { type: String, enum: ['pending', 'in_review', 'resolved', 'escalated'], default: 'pending' },
    decision: String,
    reason: String,
    resolvedAt: Date
  },
  
  // Time Tracking
  createdAt: { type: Date, default: Date.now, index: true },
  completedAt: Date,
  expiresAt: { type: Date, default: () => new Date(+new Date() + 30*24*60*60*1000) },
  lastUpdateAt: { type: Date, default: Date.now },
  
  // Additional Info
  notes: String,
  paymentMethod: String,
  completionProof: [String]
}, { timestamps: true });

// Review Schema
const reviewSchema = new mongoose.Schema({
  reviewId: { type: String, unique: true },
  dealId: { type: mongoose.Schema.Types.ObjectId, ref: 'Deal', required: true },
  reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reviewed: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: String,
  
  categories: {
    communication: { type: Number, min: 1, max: 5 },
    speed: { type: Number, min: 1, max: 5 },
    reliability: { type: Number, min: 1, max: 5 }
  },
  
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Dispute Schema
const disputeSchema = new mongoose.Schema({
  disputeId: { type: String, unique: true, index: true },
  dealId: { type: mongoose.Schema.Types.ObjectId, ref: 'Deal', required: true },
  
  complainant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  defendant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  reason: { type: String, required: true },
  description: String,
  evidence: [String],
  
  status: { type: String, enum: ['open', 'investigating', 'evidence_review', 'arbitration', 'resolved', 'closed'], default: 'open', index: true },
  priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  
  resolution: {
    verdict: String,
    compensationAmount: Number,
    reason: String,
    resolvedAt: Date
  },
  
  timeline: [{
    action: String,
    actor: mongoose.Schema.Types.ObjectId,
    timestamp: { type: Date, default: Date.now },
    details: String
  }],
  
  assignedArbitrator: mongoose.Schema.Types.ObjectId,
  
  createdAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

// Transaction Log Schema
const transactionLogSchema = new mongoose.Schema({
  txnId: { type: String, unique: true },
  userId: mongoose.Schema.Types.ObjectId,
  dealId: mongoose.Schema.Types.ObjectId,
  
  type: { type: String, enum: ['deposit', 'withdrawal', 'fee', 'refund'] },
  amount: Number,
  currency: String,
  
  status: { type: String, enum: ['pending', 'success', 'failed'] },
  hash: String,
  
  metadata: Object,
  
  createdAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

// Models
const User = mongoose.model('User', userSchema);
const Post = mongoose.model('Post', postSchema);
const Deal = mongoose.model('Deal', dealSchema);
const Review = mongoose.model('Review', reviewSchema);
const Dispute = mongoose.model('Dispute', disputeSchema);
const TransactionLog = mongoose.model('TransactionLog', transactionLogSchema);

// ============ EXPRESS SETUP ============
const app = express();
app.use(express.json());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
  next();
});

// ============ BOT SETUP ============
const bot = new TelegramBot(TOKEN, {
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

console.log('🤖 Telegram Bot initialized');

// Session Management with Redis
class SessionManager {
  async set(userId, key, value, ttl = 3600) {
    try {
      const sessionKey = `session:${userId}:${key}`;
      await redisClient.setEx(sessionKey, ttl, JSON.stringify(value));
    } catch (error) {
      console.error('Session set error:', error.message);
    }
  }

  async get(userId, key) {
    try {
      const sessionKey = `session:${userId}:${key}`;
      const data = await redisClient.get(sessionKey);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Session get error:', error.message);
      return null;
    }
  }

  async delete(userId, key) {
    try {
      const sessionKey = `session:${userId}:${key}`;
      await redisClient.del(sessionKey);
    } catch (error) {
      console.error('Session delete error:', error.message);
    }
  }

  async clear(userId) {
    try {
      const pattern = `session:${userId}:*`;
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
    } catch (error) {
      console.error('Session clear error:', error.message);
    }
  }
}

const sessionManager = new SessionManager();

// ============ UTILITY FUNCTIONS ============

const generatePostId = () => `POST-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const generateDealId = () => `DEAL-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const generateDisputeId = () => `DISPUTE-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const generateReviewId = () => `REVIEW-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

// Fetch real-time crypto prices
async function getCryptoPrices() {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: 'tether,binancecoin,solana',
        vs_currencies: 'inr',
        include_market_cap: true
      },
      timeout: 5000
    });
    
    const prices = {
      'USDT': Math.round(response.data.tether.inr),
      'BNB': Math.round(response.data.binancecoin.inr),
      'SOL': Math.round(response.data.solana.inr),
      'USDC': Math.round(response.data.tether.inr)
    };
    
    await redisClient.setEx('crypto_prices', 300, JSON.stringify(prices));
    return prices;
  } catch (error) {
    console.error('Crypto price fetch error:', error.message);
    const cached = await redisClient.get('crypto_prices').catch(() => null);
    return cached ? JSON.parse(cached) : CRYPTO_PRICES;
  }
}

// Calculate fees
function calculateFee(amount) {
  const percentageFee = (amount * TRANSACTION_FEES.PERCENT);
  const fee = Math.max(TRANSACTION_FEES.MIN, Math.min(percentageFee, TRANSACTION_FEES.MAX));
  return {
    amount: fee,
    percentage: ((fee / amount) * 100).toFixed(2),
    remaining: amount - fee
  };
}

// User verification
async function getOrCreateUser(msg) {
  try {
    let user = await User.findOne({ telegramId: msg.from.id });
    
    if (!user) {
      user = await User.create({
        telegramId: msg.from.id,
        username: msg.from.username || `user_${msg.from.id}`,
        firstName: msg.from.first_name || "User",
        lastName: msg.from.last_name || "",
        lastLogin: new Date()
      });
    }
    
    user.lastActive = new Date();
    await user.save();
    return user;
  } catch (error) {
    console.error('Get/Create user error:', error.message);
    throw error;
  }
}

// Check if user is blocked or restricted
async function isUserAllowed(userId) {
  try {
    const user = await User.findOne({ telegramId: userId });
    if (!user) return true;
    
    return user.verificationStatus !== 'blocked' && user.restrictions.canTrade;
  } catch (error) {
    console.error('User allowed check error:', error.message);
    return false;
  }
}

// Send notification with retry
async function sendNotification(userId, text, options = {}, retry = 2) {
  try {
    const user = await User.findOne({ telegramId: userId });
    
    if (!user?.notificationsEnabled) return false;
    
    return await bot.sendMessage(userId, text, {
      parse_mode: 'Markdown',
      ...options
    });
  } catch (error) {
    if (retry > 0) {
      await new Promise(r => setTimeout(r, 1000));
      return sendNotification(userId, text, options, retry - 1);
    }
    console.error(`Failed to send notification to ${userId}:`, error.message);
    return false;
  }
}

// Analytics logging
async function logAnalytics(event, data) {
  try {
    const date = new Date().toISOString().split('T')[0];
    await redisClient.hSet(`analytics:${date}`, event, JSON.stringify({...data, timestamp: new Date()}));
  } catch (error) {
    console.error('Analytics logging error:', error.message);
  }
}

// Status Emoji Helper
function getStatusEmoji(status) {
  const emojis = {
    'initiated': '🆕',
    'pending': '⏳',
    'active': '🔄',
    'in_transit': '📤',
    'completed': '✅',
    'disputed': '⚖️',
    'cancelled': '❌',
    'refunded': '💰'
  };
  return emojis[status] || '📊';
}

// ============ BOT COMMANDS ============

bot.onText(/\/start/, async (msg) => {
  try {
    const user = await getOrCreateUser(msg);
    
    const mainMenuText = `
🚀 *Welcome to Advanced USDT TO INR Escrow*

💰 Trade securely with escrow protection
🛡️ Dispute resolution system
⭐ Reputation-based trading

Your Stats:
├─ ⭐ Reputation: *${user.reputation}*
├─ ✅ Successful Deals: *${user.successfulDeals}*
├─ 💵 Total Volume: *₹${user.totalVolume.toLocaleString()}*
└─ 🔐 Status: *${user.verificationStatus.toUpperCase()}*
    `;

    await bot.sendMessage(user.telegramId, mainMenuText, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: "📝 Create Post", callback_data: "create_post" }, { text: "🔍 Browse Posts", callback_data: "browse_posts" }],
          [{ text: "💼 My Deals", callback_data: "my_deals" }, { text: "⚖️ Disputes", callback_data: "disputes_menu" }],
          [{ text: "👤 Profile", callback_data: "profile" }, { text: "📊 Statistics", callback_data: "statistics" }],
          [{ text: "⚙️ Settings", callback_data: "settings" }, { text: "🆘 Help", callback_data: "help" }]
        ]
      }
    });

    await logAnalytics('user_start', { userId: user._id });
  } catch (error) {
    console.error('/start command error:', error.message);
  }
});

// Advanced Callback Handler
bot.on("callback_query", async (q) => {
  const userId = q.from.id;
  
  try {
    const user = await getOrCreateUser({ from: q.from });

    if (!await isUserAllowed(userId) && !q.data.startsWith('profile')) {
      await bot.answerCallbackQuery(q.id, "Your account is restricted. Contact support.", true);
      return;
    }

    await bot.answerCallbackQuery(q.id);

    // ========== CREATE POST FLOW ==========
    if (q.data === "create_post") {
      await sessionManager.set(userId, 'stage', 'select_type');
      
      await bot.editMessageText("Select Transaction Type:", {
        chat_id: userId,
        message_id: q.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: "📤 SELL CRYPTO", callback_data: "type_sell" },
              { text: "📥 BUY CRYPTO", callback_data: "type_buy" }
            ],
            [{ text: "◀️ Back", callback_data: "back_to_menu" }]
          ]
        }
      });
    }

    if (q.data === "type_sell" || q.data === "type_buy") {
      const type = q.data === "type_sell" ? "sell" : "buy";
      await sessionManager.set(userId, 'post_type', type);
      
      const prices = await getCryptoPrices();
      
      await bot.editMessageText("Select Cryptocurrency:", {
        chat_id: userId,
        message_id: q.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: `₮ USDT (₹${prices.USDT})`, callback_data: "crypto_USDT" },
              { text: `🟡 BNB (₹${prices.BNB})`, callback_data: "crypto_BNB" }
            ],
            [
              { text: `◎ SOL (₹${prices.SOL})`, callback_data: "crypto_SOL" },
              { text: `🔘 USDC (₹${prices.USDC})`, callback_data: "crypto_USDC" }
            ],
            [{ text: "◀️ Back", callback_data: "back_to_menu" }]
          ]
        }
      });
    }

    if (q.data.startsWith("crypto_")) {
      const crypto = q.data.split("_")[1];
      await sessionManager.set(userId, 'post_crypto', crypto);
      
      await bot.sendMessage(userId, `💰 Enter amount in *${crypto}*:\n\n_Minimum: 0.01, Maximum: 1,000,000_`, {
        parse_mode: 'Markdown',
        reply_markup: { force_reply: true }
      });
    }

    // ========== PROFILE & REPUTATION ==========
    if (q.data === "profile") {
      const deals = await Deal.countDocuments({ $or: [{ buyer: user._id }, { seller: user._id }], status: 'completed' });
      const reviews = await Review.find({ reviewed: user._id });
      const avgRating = reviews.length > 0 ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(2) : "N/A";
      
      const profileText = `
👤 *Your Profile*

├─ Name: *${user.firstName} ${user.lastName}*
├─ Username: @${user.username}
├─ Member Since: *${user.createdAt.toLocaleDateString('en-IN')}*
│
├─ ⭐ Reputation: *${user.reputation}*
├─ ✅ Completed Deals: *${user.successfulDeals}*
├─ 📊 Average Rating: *${avgR
