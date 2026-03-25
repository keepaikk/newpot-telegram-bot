require('dotenv/config');
const axios = require('axios');

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:3000/api';
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_CHAT_ID = process.env.TELEGRAM_CHAT_ID; // Kk's chat ID for alerts

// In-memory user sessions (for demo - use Redis in production)
const userSessions = new Map();

// Market cache
let marketsCache = [];
let marketsCacheTime = 0;
const CACHE_TTL = 30000; // 30 seconds

// Helper: Fetch markets from API
async function getMarkets() {
  if (Date.now() - marketsCacheTime < CACHE_TTL && marketsCache.length > 0) {
    return marketsCache;
  }
  try {
    const res = await axios.get(`${API_URL}/markets`);
    marketsCache = res.data.data || [];
    marketsCacheTime = Date.now();
    return marketsCache;
  } catch (err) {
    console.error('API error:', err.message);
    return marketsCache;
  }
}

// Helper: Get user portfolio
async function getPortfolio(userId) {
  try {
    const res = await axios.get(`${API_URL}/bets/positions`, {
      headers: { 'x-user-id': userId }
    });
    return res.data.data || [];
  } catch (err) {
    return [];
  }
}

// Helper: Get user balance
async function getBalance(userId) {
  try {
    const res = await axios.get(`${API_URL}/wallet/balance`, {
      headers: { 'x-user-id': userId }
    });
    return res.data.data;
  } catch (err) {
    return null;
  }
}

// Helper: Place bet
async function placeBet(userId, marketId, side, amount, paymentMethod = 'MTN') {
  try {
    const res = await axios.post(
      `${API_URL}/bets`,
      { marketId, side, amount, paymentMethod },
      { headers: { 'x-user-id': userId } }
    );
    return res.data;
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    return { success: false, error: { message: msg } };
  }
}

// Helper: Deposit
async function deposit(userId, amount, paymentMethod = 'MTN') {
  try {
    const res = await axios.post(
      `${API_URL}/wallet/deposit`,
      { paymentMethod, amount, currency: 'GHS' },
      { headers: { 'x-user-id': userId } }
    );
    return res.data;
  } catch (err) {
    return { success: false, error: { message: err.message } };
  }
}

// Helper: Send Telegram message
async function sendMessage(chatId, text, extra = {}) {
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      ...extra
    });
  } catch (err) {
    console.error('Send error:', err.message);
  }
}

// Helper: Get Telegram user display name
function displayName(ctx) {
  const u = ctx.message.from;
  return u.username ? `@${u.username}` : u.first_name || 'Trader';
}

// ============================================
// COMMAND HANDLERS
// ============================================

async function cmdStart(ctx) {
  const name = displayName(ctx);
  const msg = `🇬🇭 *Welcome to Newpot!*

${name}, Ghana's prediction market.

*How it works:*
1️⃣ Deposit GHS via Mobile Money
2️⃣ Pick a market (election, sports, crypto...)
3️⃣ Buy YES or NO shares
4️⃣ Win if you're right!

*Your commands:*
/markets — Browse markets
/deposit — Add funds
/balance — Check wallet
/portfolio — Your positions
/help — All commands

*Getting started:*
Type /deposit to add your first GHS!`;

  await sendMessage(ctx.message.chat.id, msg);
}

async function cmdMarkets(ctx) {
  const chatId = ctx.message.chat.id;
  const markets = await getMarkets();

  if (markets.length === 0) {
    await sendMessage(chatId, '📭 No markets available right now. Check back soon!');
    return;
  }

  let msg = `📊 *Newpot Markets*\n${markets.length} active markets:\n\n`;

  for (const m of markets) {
    const endDate = new Date(m.endDate);
    const daysLeft = Math.ceil((endDate - Date.now()) / (1000 * 60 * 60 * 24));
    const odds = `YES ${(m.yesPrice * 100).toFixed(0)}% | NO ${(m.noPrice * 100).toFixed(0)}%`;
    const status = m.isResolved ? '✅ RESOLVED' : `⏳ ${daysLeft}d left`;

    msg += `*[${m.id}]* ${m.title}\n`;
    msg += `   ${odds} | Vol: GHS ${(m.volume || 0).toLocaleString()}\n`;
    msg += `   ${status}\n\n`;
  }

  msg += `_Bet: /buy YES [id] [amount]_`;
  await sendMessage(chatId, msg);
}

async function cmdOdds(ctx, args) {
  const chatId = ctx.message.chat.id;

  if (!args[0]) {
    await sendMessage(chatId, '📖 Usage: /odds [market_id]\nExample: /odds 1');
    return;
  }

  const marketId = args[0];
  const markets = await getMarkets();
  const m = markets.find(x => x.id === marketId);

  if (!m) {
    await sendMessage(chatId, `❌ Market [${marketId}] not found. Use /markets to see all.`);
    return;
  }

  const endDate = new Date(m.endDate);
  const daysLeft = Math.ceil((endDate - Date.now()) / (1000 * 60 * 60 * 24));
  const yesPayout = (1 / m.yesPrice).toFixed(2);
  const noPayout = (1 / m.noPrice).toFixed(2);

  let msg = `📈 *[${m.id}]* ${m.title}\n\n`;
  msg += `📝 ${m.description}\n\n`;
  msg += `💰 *Odds:*\n`;
  msg += `   YES: ${(m.yesPrice * 100).toFixed(1)}% — payout x${yesPayout}\n`;
  msg += `   NO:  ${(m.noPrice * 100).toFixed(1)}% — payout x${noPayout}\n\n`;
  msg += `📊 Volume: GHS ${(m.volume || 0).toLocaleString()}\n`;
  msg += `⏰ Settles: ${endDate.toLocaleDateString('en-GB')} (${daysLeft}d)\n\n`;
  msg += `_Bet: /buy YES ${m.id} 50_ or _/buy NO ${m.id} 50_`;

  await sendMessage(chatId, msg);
}

async function cmdBuy(ctx, args) {
  const chatId = ctx.message.chat.id;
  const userId = String(ctx.message.from.id);

  // Parse: /buy YES 1 100
  if (args.length < 3) {
    await sendMessage(chatId, `📖 Usage: /buy YES [market_id] [amount]
Example: /buy YES 1 100
         /buy NO 2 50

💡 Amount in GHS (Ghana Cedis)`);
    return;
  }

  const side = args[0].toUpperCase();
  const marketId = args[1];
  const amount = parseFloat(args[2]);

  if (!['YES', 'NO'].includes(side)) {
    await sendMessage(chatId, '❌ Side must be YES or NO\nExample: /buy YES 1 100');
    return;
  }

  if (isNaN(amount) || amount < 1) {
    await sendMessage(chatId, '❌ Minimum bet is GHS 1.00');
    return;
  }

  // Check balance FIRST
  const balance = await getBalance(userId);
  if (!balance) {
    await sendMessage(chatId, '❌ Could not load your wallet. Try /balance first.');
    return;
  }

  const mtnBalance = balance.mobileMoneyBalances?.find(b => b.provider === 'MTN');
  const available = mtnBalance?.balance || 0;

  if (available < amount) {
    await sendMessage(chatId, `❌ Insufficient balance.\n\nYour MTN balance: GHS ${available.toFixed(2)}\nBet amount: GHS ${amount.toFixed(2)}\n\nTop up: /deposit`);
    return;
  }

  // Get market info for payout calc
  const markets = await getMarkets();
  const m = markets.find(x => x.id === marketId);
  if (!m) {
    await sendMessage(chatId, `❌ Market [${marketId}] not found.`);
    return;
  }

  const price = side === 'YES' ? m.yesPrice : m.noPrice;
  const shares = (amount / price).toFixed(2);
  const potentialPayout = shares;

  // Place bet
  const result = await placeBet(userId, marketId, side, amount, 'MTN');

  if (!result.success) {
    await sendMessage(chatId, `❌ Bet failed: ${result.error?.message || 'Unknown error'}`);
    return;
  }

  const payout = (shares * 0.97).toFixed(2); // 3% house fee
  let msg = `✅ *Bet placed!*\n\n`;
  msg += `📊 Market: ${m.title}\n`;
  msg += `🎯 Your pick: *${side}*\n`;
  msg += `💵 Stake: GHS ${amount.toFixed(2)}\n`;
  msg += `📊 Shares: ${shares}\n`;
  msg += `💰 Potential payout: *GHS ${payout}*\n\n`;
  msg += `_3% house fee applied at settlement_`;

  await sendMessage(chatId, msg);

  // Log to owner
  if (OWNER_CHAT_ID && OWNER_CHAT_ID !== String(chatId)) {
    const name = displayName(ctx);
    await sendMessage(OWNER_CHAT_ID, `💰 *Bet placed!*
${name} bet GHS ${amount} on ${side} for market [${marketId}]
Potential payout: GHS ${payout}`);
  }
}

async function cmdDeposit(ctx, args) {
  const chatId = ctx.message.chat.id;
  const userId = String(ctx.message.from.id);

  // For MVP: simulate deposit with a reference number
  // In production: integrate with MTN MoMo API
  let amount = parseFloat(args[0]);
  if (isNaN(amount) || amount < 1) {
    const msg = `💰 *Deposit GHS via Mobile Money*

Send money to: *054 444 1234* (MTN MoMo)
Account name: *Newpot*

Then reply with your:
- MoMo reference number
- Amount deposited

Example: _I sent 100 GHS, ref: 123456_

Or type /deposit [amount] to simulate:
/deposit 100`;

    await sendMessage(chatId, msg);
    return;
  }

  // Simulate deposit for MVP
  const result = await deposit(userId, amount, 'MTN');

  if (result.success) {
    const msg = `✅ *Deposit confirmed!*

GHS ${amount.toFixed(2)} credited to your MTN wallet.

Place your first bet: /buy YES 1 ${amount}`;

    await sendMessage(chatId, msg);
  } else {
    await sendMessage(chatId, `❌ Deposit failed: ${result.error?.message || 'Try again'}`);
  }
}

async function cmdBalance(ctx) {
  const chatId = ctx.message.chat.id;
  const userId = String(ctx.message.from.id);
  const balance = await getBalance(userId);

  if (!balance) {
    await sendMessage(chatId, '📭 Could not load balance. Make sure the API is running.');
    return;
  }

  let msg = `💼 *Your Wallet*\n\n*Mobile Money:*\n`;

  for (const b of balance.mobileMoneyBalances || []) {
    msg += `  ${b.provider}: GHS ${b.balance.toFixed(2)}\n`;
  }

  msg += `\n*Crypto:*\n`;
  for (const [asset, amt] of Object.entries(balance.crypto || {})) {
    if (amt > 0) msg += `  ${asset}: ${amt.toFixed(4)}\n`;
  }

  if ((balance.mobileMoneyBalances || []).length === 0 && Object.values(balance.crypto || {}).every(v => v === 0)) {
    msg = '💼 *Empty wallet*\n\nDeposit: /deposit';
  }

  await sendMessage(chatId, msg);
}

async function cmdPortfolio(ctx) {
  const chatId = ctx.message.chat.id;
  const userId = String(ctx.message.from.id);

  const positions = await getPortfolio(userId);
  const markets = await getMarkets();

  if (positions.length === 0) {
    await sendMessage(chatId, '📭 No positions yet.\n\nBrowse markets: /markets\nPlace a bet: /buy YES 1 10');
    return;
  }

  let msg = `📊 *Your Portfolio*\n${positions.length} positions:\n\n`;
  let totalValue = 0;

  for (const pos of positions) {
    const m = markets.find(x => x.id === pos.marketId);
    const marketTitle = m ? m.title : `Market ${pos.marketId}`;
    const currentPrice = pos.side === 'YES' ? (m?.yesPrice || 0) : (m?.noPrice || 0);
    const value = pos.shares * currentPrice;
    const pnl = value - pos.amount;
    const pnlEmoji = pnl >= 0 ? '📈' : '📉';

    totalValue += value;

    msg += `${pnlEmoji} *${pos.side}* — ${marketTitle}\n`;
    msg += `   Stake: GHS ${pos.amount.toFixed(2)} | Shares: ${pos.shares.toFixed(2)}\n`;
    msg += `   Now worth: GHS ${value.toFixed(2)} (${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)})\n\n`;
  }

  msg += `Portfolio value: GHS ${totalValue.toFixed(2)}`;

  await sendMessage(chatId, msg);
}

async function cmdHelp(ctx) {
  const msg = `📖 *Newpot Commands*

*Trading:*
/markets — List all markets
/odds [id] — Detailed market info
/buy YES [id] [amt] — Buy YES shares
/buy NO [id] [amt] — Buy NO shares
/portfolio — Your positions

*Wallet:*
/deposit — Add funds via MoMo
/deposit [amt] — Simulate deposit
/balance — Check balances
/withdraw — Withdraw winnings

*Bot:*
/start — Welcome message
/help — This guide

*How to bet:*
1. /deposit to add GHS
2. /markets to pick a market
3. /buy YES 1 50 — bet 50 GHS on YES
4. If you're right, win up to 97 GHS!`;

  await sendMessage(ctx.message.chat.id, msg);
}

// ============================================
// TELEGRAM WEBHOOK
// ============================================

async function handleUpdate(update) {
  if (!update.message) return;

  const { message } = update;
  const text = message.text || '';
  const chatId = message.chat.id;

  console.log(`📨 ${message.from.username || message.from.id}: ${text}`);

  // Route commands
  if (text === '/start') await cmdStart(message);
  else if (text === '/markets') await cmdMarkets(message);
  else if (text.startsWith('/odds')) await cmdOdds(message, text.split(' ').slice(1));
  else if (text.startsWith('/buy')) await cmdBuy(message, text.split(' ').slice(1));
  else if (text.startsWith('/deposit')) await cmdDeposit(message, text.split(' ').slice(1));
  else if (text === '/balance') await cmdBalance(message);
  else if (text === '/portfolio') await cmdPortfolio(message);
  else if (text === '/withdraw') await sendMessage(chatId, '🏧 Withdrawals: Contact @newpot_support');
  else if (text === '/help') await cmdHelp(message);
  else if (text.startsWith('/')) await sendMessage(chatId, '❓ Unknown command. Try /help');
}

// Poll loop (runs when no webhook configured)
async function startPolling() {
  let offset = 0;

  console.log('🔄 Starting polling...');

  while (true) {
    try {
      const res = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`, {
        params: { offset: offset + 1, timeout: 30 }
      });

      for (const update of res.data.result || []) {
        offset = update.update_id;
        await handleUpdate(update);
      }
    } catch (err) {
      console.error('Poll error:', err.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// Health check
async function healthCheck() {
  try {
    await axios.get(`${API_URL}/markets`);
    return true;
  } catch {
    return false;
  }
}

// Export for testing
module.exports = { cmdStart, cmdMarkets, cmdOdds, cmdBuy, cmdDeposit, cmdBalance, cmdPortfolio };

// Start
if (require.main === module) {
  if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN not set');
    process.exit(1);
  }

  console.log('🚀 Newpot Telegram Bot starting...');
  console.log(`📡 API: ${API_URL}`);

  startPolling();
}
