require('dotenv/config');
const axios = require('axios');

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:5000/api';
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Market cache
let marketsCache = [];
let marketsCacheTime = 0;
const CACHE_TTL = 30000;

// User state for multi-step flows
const userStates = new Map();

// ============================================
// API HELPERS
// ============================================

async function getMarkets() {
  if (Date.now() - marketsCacheTime < CACHE_TTL && marketsCache.length > 0) {
    return marketsCache;
  }
  try {
    const res = await axios.get(`${API_URL}/markets`);
    marketsCache = res.data.data || [];
    marketsCacheTime = Date.now();
    return marketsCache;
  } catch {
    return marketsCache;
  }
}

async function getBalance(userId) {
  try {
    const res = await axios.get(`${API_URL}/wallet/balance`, {
      headers: { 'x-user-id': userId }
    });
    return res.data.data;
  } catch {
    return null;
  }
}

async function placeBet(userId, marketId, side, amount, paymentMethod = 'MTN') {
  try {
    const res = await axios.post(
      `${API_URL}/bets`,
      { marketId, side, amount, paymentMethod },
      { headers: { 'x-user-id': userId } }
    );
    return res.data;
  } catch (err) {
    return err.response?.data || { success: false, error: { message: err.message } };
  }
}

async function deposit(userId, amount, paymentMethod = 'MTN') {
  try {
    const res = await axios.post(
      `${API_URL}/wallet/deposit`,
      { paymentMethod, amount, currency: 'GHS' },
      { headers: { 'x-user-id': userId } }
    );
    return res.data;
  } catch {
    return { success: false, error: { message: 'Deposit failed' } };
  }
}

async function getPortfolio(userId) {
  try {
    const res = await axios.get(`${API_URL}/bets/positions`, {
      headers: { 'x-user-id': userId }
    });
    return res.data.data || [];
  } catch {
    return [];
  }
}

// ============================================
// TELEGRAM HELPERS
// ============================================

async function sendMessage(chatId, text, opts = {}) {
  try {
    const payload = {
      chat_id: chatId,
      text,
      parse_mode: opts.parse_mode || 'Markdown',
      reply_markup: opts.reply_markup,
      disable_web_page_preview: true
    };
    if (opts.reply_to_message_id) payload.reply_to_message_id = opts.reply_to_message_id;
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, payload);
  } catch (err) {
    console.error('Send error:', err.message);
  }
}

async function editMessage(chatId, messageId, text, opts = {}) {
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: opts.parse_mode || 'Markdown',
      reply_markup: opts.reply_markup
    });
  } catch {}
}

async function answerCallback(queryId, text, show_alert = false) {
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
      callback_query_id: queryId,
      text,
      show_alert
    });
  } catch {}
}

// ============================================
// KEYBOARDS
// ============================================

function mainMenu() {
  return JSON.stringify({
    keyboard: [
      [{ text: '📊 Markets' }, { text: '💼 Wallet' }],
      [{ text: '📈 Portfolio' }, { text: '❓ Help' }]
    ],
    resize_keyboard: true
  });
}

function marketsListKeyboard(markets) {
  const rows = markets.map(m => [{
    text: `${m.yesPrice >= 0.5 ? '🟢' : '🔴'} ${m.title.substring(0, 35)}...`,
    callback_data: `market_${m.id}`
  }]);
  rows.push([{ text: '🔙 Back to Menu', callback_data: 'menu' }]);
  return JSON.stringify({ inline_keyboard: rows });
}

function betConfirmKeyboard(marketId, side) {
  return JSON.stringify({
    inline_keyboard: [
      [
        { text: '✅ Yes, Place Bet', callback_data: `confirm_${side}_${marketId}` },
        { text: '❌ Cancel', callback_data: `market_${marketId}` }
      ]
    ]
  });
}

function amountQuickKeyboard() {
  return JSON.stringify({
    inline_keyboard: [
      [{ text: '10 GHS', callback_data: 'amt_10' }, { text: '25 GHS', callback_data: 'amt_25' }, { text: '50 GHS', callback_data: 'amt_50' }],
      [{ text: '100 GHS', callback_data: 'amt_100' }, { text: '200 GHS', callback_data: 'amt_200' }],
      [{ text: '🔙 Cancel', callback_data: 'menu' }]
    ]
  });
}

function depositConfirmKeyboard() {
  return JSON.stringify({
    inline_keyboard: [
      [
        { text: '✅ Confirm 50 GHS', callback_data: 'deposit_50' },
        { text: '💰 Other Amount', callback_data: 'deposit_custom' }
      ],
      [{ text: '❌ Cancel', callback_data: 'menu' }]
    ]
  });
}

function walletKeyboard() {
  return JSON.stringify({
    inline_keyboard: [
      [{ text: '💰 Deposit', callback_data: 'deposit_menu' }],
      [{ text: '📤 Withdraw', callback_data: 'withdraw_menu' }],
      [{ text: '📜 Transaction History', callback_data: 'tx_history' }],
      [{ text: '🔙 Back to Menu', callback_data: 'menu' }]
    ]
  });
}

// ============================================
// COMMAND HANDLERS
// ============================================

async function cmdStart(chatId, userId) {
  userStates.delete(userId);
  
  const balance = await getBalance(userId);
  const mtnBal = balance?.mobileMoneyBalances?.find(b => b.provider === 'MTN')?.balance || 0;
  
  let msg = `🇬🇭 *Welcome to Newpot!*

Ghana's prediction market.
Predict. Bet. Win.

━━━━━━━━━━━━━━━━━━
💼 *Your Wallet*
MTN MoMo: *GHS ${mtnBal.toFixed(2)}*
━━━━━━━━━━━━━━━━━━

Choose an option below:`;

  await sendMessage(chatId, msg, { reply_markup: mainMenu() });
}

async function showMarkets(chatId, userId, messageId = null) {
  const markets = await getMarkets();
  userStates.delete(userId);
  
  if (markets.length === 0) {
    await sendMessage(chatId, '📭 No markets available right now.');
    return;
  }

  let msg = `📊 *Active Markets*\nSelect a market to view odds and bet:\n\n`;
  
  markets.forEach((m, i) => {
    const endDate = new Date(m.endDate);
    const days = Math.ceil((endDate - Date.now()) / (1000 * 60 * 60 * 24));
    const status = m.isResolved ? '✅' : '⏳';
    
    msg += `*${i + 1}.* ${m.title}\n`;
    msg += `   🟢 YES ${(m.yesPrice * 100).toFixed(0)}% | 🔴 NO ${(m.noPrice * 100).toFixed(0)}%\n`;
    msg += `   ${status} ${days > 0 ? days + 'd left' : 'ENDING SOON'} | Vol: GHS ${(m.volume || 0).toLocaleString()}\n\n`;
  });

  const opts = messageId ? { reply_markup: marketsListKeyboard(markets) } : { reply_markup: marketsListKeyboard(markets) };
  
  if (messageId) {
    await editMessage(chatId, messageId, msg, opts);
  } else {
    await sendMessage(chatId, msg, opts);
  }
}

async function showMarketDetail(chatId, userId, marketId, messageId = null) {
  const markets = await getMarkets();
  const m = markets.find(x => x.id === marketId);
  
  if (!m) {
    await sendMessage(chatId, '❌ Market not found.');
    return;
  }

  const endDate = new Date(m.endDate);
  const days = Math.ceil((endDate - Date.now()) / (1000 * 60 * 60 * 24));
  const yesPayout = (1 / m.yesPrice).toFixed(2);
  const noPayout = (1 / m.noPrice).toFixed(2);
  const balance = await getBalance(userId);
  const mtnBal = balance?.mobileMoneyBalances?.find(b => b.provider === 'MTN')?.balance || 0;

  let msg = `📈 *${m.title}*\n\n`;
  msg += `${m.description}\n\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `🟢 *YES:* ${(m.yesPrice * 100).toFixed(1)}% — Win *GHS ${yesPayout}* per GHS 1\n`;
  msg += `🔴 *NO:*  ${(m.noPrice * 100).toFixed(1)}% — Win *GHS ${noPayout}* per GHS 1\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `📊 Volume: GHS ${(m.volume || 0).toLocaleString()}\n`;
  msg += `⏰ Settles: ${endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} (${days}d)\n`;
  msg += `💼 Your MTN balance: *GHS ${mtnBal.toFixed(2)}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `Select your prediction:`;

  const keyboard = JSON.stringify({
    inline_keyboard: [
      [
        { text: `🟢 BET YES @ ${(m.yesPrice * 100).toFixed(0)}%`, callback_data: `side_YES_${m.id}` },
        { text: `🔴 BET NO @ ${(m.noPrice * 100).toFixed(0)}%`, callback_data: `side_NO_${m.id}` }
      ],
      [{ text: '📊 More Markets', callback_data: 'all_markets' }],
      [{ text: '🔙 Main Menu', callback_data: 'menu' }]
    ]
  });

  if (messageId) {
    await editMessage(chatId, messageId, msg, { reply_markup: keyboard });
  } else {
    await sendMessage(chatId, msg, { reply_markup: keyboard });
  }
}

async function showBetAmount(chatId, userId, side, marketId) {
  const markets = await getMarkets();
  const m = markets.find(x => x.id === marketId);
  if (!m) return;

  const price = side === 'YES' ? m.yesPrice : m.noPrice;
  const balance = await getBalance(userId);
  const mtnBal = balance?.mobileMoneyBalances?.find(b => b.provider === 'MTN')?.balance || 0;

  // Store user's bet intent
  userStates.set(userId, {
    action: 'betting',
    marketId,
    side,
    price
  });

  const emoji = side === 'YES' ? '🟢' : '🔴';
  
  let msg = `${emoji} *Bet on ${side}*\n\n`;
  msg += `📊 Market: ${m.title}\n`;
  msg += `💰 Odds: ${(price * 100).toFixed(1)}%\n`;
  msg += `💼 Available: GHS ${mtnBal.toFixed(2)}\n\n`;
  msg += `*Select amount to bet:*`;

  await sendMessage(chatId, msg, {
    reply_markup: JSON.stringify({
      inline_keyboard: [
        [{ text: '10 GHS', callback_data: `bet_${marketId}_${side}_10` }, { text: '25 GHS', callback_data: `bet_${marketId}_${side}_25` }, { text: '50 GHS', callback_data: `bet_${marketId}_${side}_50` }],
        [{ text: '100 GHS', callback_data: `bet_${marketId}_${side}_100` }, { text: '200 GHS', callback_data: `bet_${marketId}_${side}_200` }],
        [{ text: '💬 Enter Custom', callback_data: `bet_custom_${marketId}_${side}` }],
        [{ text: '❌ Cancel', callback_data: `market_${marketId}` }]
      ]
    })
  });
}

async function executeBet(chatId, userId, marketId, side, amount) {
  const balance = await getBalance(userId);
  const mtnBal = balance?.mobileMoneyBalances?.find(b => b.provider === 'MTN')?.balance || 0;
  
  if (mtnBal < amount) {
    await sendMessage(chatId, `❌ *Insufficient balance*\n\nYour MTN balance: GHS ${mtnBal.toFixed(2)}\nBet amount: GHS ${amount.toFixed(2)}\n\nPlease deposit first: /deposit`, {
      reply_markup: mainMenu()
    });
    return;
  }

  const result = await placeBet(userId, marketId, side, amount, 'MTN');
  
  if (!result.success) {
    await sendMessage(chatId, `❌ *Bet failed*\n\n${result.error?.message || 'Unknown error'}\n\nPlease try again.`, {
      reply_markup: mainMenu()
    });
    return;
  }

  const shares = result.data?.user_shares || (amount / (side === 'YES' ? 0.35 : 0.65));
  const payout = (shares * 0.97).toFixed(2); // 3% house fee
  const emoji = side === 'YES' ? '🟢' : '🔴';

  let msg = `✅ *Bet Placed!*\n\n`;
  msg += `${emoji} You bet *GHS ${amount.toFixed(2)}* on *${side}*\n\n`;
  msg += `📊 Shares: ${parseFloat(shares).toFixed(2)}\n`;
  msg += `💰 Potential payout: *GHS ${payout}*\n`;
  msg += `_3% house fee applied at settlement_`;

  await sendMessage(chatId, msg, { reply_markup: mainMenu() });

  // Alert owner
  if (OWNER_CHAT_ID && OWNER_CHAT_ID !== String(chatId)) {
    const user = await getBalance(userId);
    await sendMessage(OWNER_CHAT_ID, `💰 *New bet!*
User ${userId} bet GHS ${amount} on ${side}
Market [${marketId}] | Shares: ${shares}
Potential payout: GHS ${payout}`);
  }
}

async function showDeposit(chatId, userId) {
  userStates.delete(userId);
  
  let msg = `💰 *Deposit GHS*\n\n`;
  msg += `Send money via MTN MoMo:\n`;
  msg += `📱 *054 444 1234*\n`;
  msg += `👤 *Newpot Ghana*\n\n`;
  msg += `Then reply with:\n`;
  msg += `• MoMo reference number\n`;
  msg += `• Amount sent\n\n`;
  msg += `Example: _"I sent 100 GHS, ref: 123456789"_`;

  await sendMessage(chatId, msg, {
    reply_markup: JSON.stringify({
      inline_keyboard: [
        [{ text: '💰 Deposit 50 GHS (Demo)', callback_data: 'deposit_demo_50' }],
        [{ text: '💰 Deposit 100 GHS (Demo)', callback_data: 'deposit_demo_100' }],
        [{ text: '🔙 Back to Menu', callback_data: 'menu' }]
      ]
    })
  });
}

async function executeDeposit(chatId, userId, amount) {
  const result = await deposit(userId, amount, 'MTN');
  
  if (result.success) {
    const newBalance = await getBalance(userId);
    const mtnBal = newBalance?.mobileMoneyBalances?.find(b => b.provider === 'MTN')?.balance || 0;
    
    let msg = `✅ *Deposit Confirmed!*\n\n`;
    msg += `💰 +GHS ${amount.toFixed(2)} credited\n`;
    msg += `💼 New balance: *GHS ${mtnBal.toFixed(2)}*\n\n`;
    msg += `_Ready to place bets!_`;

    await sendMessage(chatId, msg, { reply_markup: mainMenu() });
  } else {
    await sendMessage(chatId, `❌ Deposit failed. Please try again.`, {
      reply_markup: mainMenu()
    });
  }
}

async function showWallet(chatId, userId) {
  const balance = await getBalance(userId);
  
  let msg = `💼 *Your Wallet*\n\n`;
  
  msg += `*Mobile Money:*\n`;
  for (const b of balance?.mobileMoneyBalances || []) {
    const flag = b.provider === 'MTN' ? '📱' : b.provider === 'VODAFONE' ? '📞' : '📲';
    msg += `${flag} ${b.provider}: *GHS ${b.balance.toFixed(2)}*\n`;
  }
  
  if ((balance?.mobileMoneyBalances || []).length === 0) {
    msg += `_No mobile money added yet_\n`;
  }

  msg += `\n*Crypto:*\n`;
  for (const [asset, amt] of Object.entries(balance?.crypto || {})) {
    if (amt > 0) msg += `💎 ${asset}: *${amt.toFixed(4)}*\n`;
  }

  if ((balance?.mobileMoneyBalances || []).length === 0 && Object.values(balance?.crypto || {}).every(v => v === 0)) {
    msg += `\n_Send /deposit to add funds_`;
  }

  await sendMessage(chatId, msg, { reply_markup: walletKeyboard() });
}

async function showPortfolio(chatId, userId) {
  const positions = await getPortfolio(userId);
  const markets = await getMarkets();

  if (positions.length === 0) {
    await sendMessage(chatId, `📭 *No positions yet*\n\nStart trading:\n1. /markets — see active markets\n2. Choose YES or NO\n3. Place your bet!`, {
      reply_markup: mainMenu()
    });
    return;
  }

  let msg = `📈 *Your Portfolio*\n${positions.length} positions:\n\n`;
  let totalValue = 0;
  let totalPnl = 0;

  for (const pos of positions) {
    const m = markets.find(x => x.id === pos.marketId);
    const marketTitle = m ? m.title.substring(0, 30) : `Market ${pos.marketId}`;
    const currentPrice = pos.side === 'YES' ? (m?.yesPrice || 0) : (m?.noPrice || 0);
    const value = pos.shares * currentPrice;
    const pnl = value - pos.amount;
    const pnlEmoji = pnl >= 0 ? '📈' : '📉';
    const emoji = pos.side === 'YES' ? '🟢' : '🔴';

    totalValue += value;
    totalPnl += pnl;

    msg += `${emoji} *${marketTitle}*\n`;
    msg += `   ${pnlEmoji} Stake: GHS ${pos.amount.toFixed(2)} → Worth: GHS ${value.toFixed(2)}\n`;
    msg += `   P&L: ${pnl >= 0 ? '+' : ''}GHS ${pnl.toFixed(2)}\n\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `💼 Total value: *GHS ${totalValue.toFixed(2)}*\n`;
  msg += `📊 Total P&L: ${totalPnl >= 0 ? '+' : ''}*GHS ${totalPnl.toFixed(2)}*`;
  msg += `\n━━━━━━━━━━━━━━━━━━`;

  await sendMessage(chatId, msg, { reply_markup: mainMenu() });
}

async function showHelp(chatId) {
  let msg = `📖 *Newpot Help*\n\n`;
  msg += `*How to trade:*\n`;
  msg += `1. 💰 Deposit GHS via MTN MoMo\n`;
  msg += `2. 📊 Browse /markets\n`;
  msg += `3. 🟢🔴 Pick YES or NO\n`;
  msg += `4. 💵 Enter your stake\n`;
  msg += `5. ✅ Confirm and bet placed!\n\n`;
  msg += `*If your prediction is correct:*\n`;
  msg += `You win GHS (stake × odds)\n`;
  msg += `_Minus 3% house fee at settlement_\n\n`;
  msg += `*Commands:*\n`;
  msg += `/start — Main menu\n`;
  msg += `/markets — Browse markets\n`;
  msg += `/deposit — Add funds\n`;
  msg += `/balance — Check wallet\n`;
  msg += `/portfolio — Your positions\n`;
  msg += `/help — This guide`;

  await sendMessage(chatId, msg, { reply_markup: mainMenu() });
}

// ============================================
// CALLBACK HANDLER
// ============================================

async function handleCallback(chatId, userId, queryId, data) {
  const parts = data.split('_');
  const action = parts[0];

  if (action === 'menu') {
    await answerCallback(queryId, '');
    await cmdStart(chatId, userId);
  }
  else if (action === 'all_markets' || action === 'markets') {
    await answerCallback(queryId, '');
    await showMarkets(chatId, userId);
  }
  else if (action === 'market') {
    await answerCallback(queryId, '');
    await showMarketDetail(chatId, userId, parts[1]);
  }
  else if (action === 'side') {
    await answerCallback(queryId, '');
    await showBetAmount(chatId, userId, parts[1], parts[2]);
  }
  else if (action === 'bet') {
    await answerCallback(queryId, '');
    const marketId = parts[1];
    const side = parts[2];
    const amount = parseFloat(parts[3]);
    await executeBet(chatId, userId, marketId, side, amount);
  }
  else if (action === 'deposit' || action === 'deposit_demo') {
    await answerCallback(queryId, '');
    const amount = action === 'deposit_demo' ? parseFloat(parts[2]) : parseFloat(parts[1]);
    if (amount > 0) {
      await executeDeposit(chatId, userId, amount);
    } else {
      await showDeposit(chatId, userId);
    }
  }
  else if (action === 'deposit_menu') {
    await answerCallback(queryId, '');
    await showDeposit(chatId, userId);
  }
  else if (action === 'wallet' || action === 'menu') {
    await answerCallback(queryId, '');
    await showWallet(chatId, userId);
  }
  else if (action === 'portfolio') {
    await answerCallback(queryId, '');
    await showPortfolio(chatId, userId);
  }
  else if (action === 'back') {
    await answerCallback(queryId, '');
    await cmdStart(chatId, userId);
  }
  else {
    await answerCallback(queryId, 'Unknown action');
  }
}

// ============================================
// MESSAGE HANDLER
// ============================================

async function handleMessage(message) {
  const chatId = message.chat.id;
  const userId = String(message.from.id);
  const text = message.text || '';

  // Handle text commands
  if (text === '/start') {
    await cmdStart(chatId, userId);
  }
  else if (text === '/markets' || text === '/market') {
    await showMarkets(chatId, userId);
  }
  else if (text.startsWith('/odds')) {
    const id = text.split(' ')[1];
    if (id) await showMarketDetail(chatId, userId, id);
    else await sendMessage(chatId, 'Usage: /odds [market_id]');
  }
  else if (text === '/deposit' || text === '/deposit@Newsppot_bot') {
    await showDeposit(chatId, userId);
  }
  else if (text === '/balance' || text === '/wallet') {
    await showWallet(chatId, userId);
  }
  else if (text === '/portfolio' || text === '/port') {
    await showPortfolio(chatId, userId);
  }
  else if (text === '/help' || text === '/start@Newsppot_bot') {
    await showHelp(chatId);
  }
  else {
    // Check if user is in a state expecting text input
    const state = userStates.get(userId);
    if (state?.action === 'betting' && state.customAmount) {
      // Handle custom bet amount
      const amount = parseFloat(text);
      if (!isNaN(amount) && amount > 0) {
        userStates.delete(userId);
        await executeBet(chatId, userId, state.marketId, state.side, amount);
      } else {
        await sendMessage(chatId, '❌ Invalid amount. Please enter a number.');
      }
    }
  }
}

// ============================================
// POLLING LOOP
// ============================================

async function startPolling() {
  let offset = 0;
  console.log('🔄 Newpot Bot polling...');

  while (true) {
    try {
      const res = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`, {
        params: { offset: offset + 1, timeout: 30 }
      });

      for (const update of res.data.result || []) {
        offset = update.update_id;

        if (update.callback_query) {
          const cb = update.callback_query;
          const chatId = cb.message.chat.id;
          const userId = String(cb.from.id);
          await handleCallback(chatId, userId, cb.id, cb.data);
        }
        else if (update.message) {
          await handleMessage(update.message);
        }
      }
    } catch (err) {
      console.error('Poll error:', err.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ============================================
// START
// ============================================

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN not set');
  process.exit(1);
}

console.log('🚀 Newpot Telegram Bot starting...');
console.log(`📡 API: ${API_URL}`);

startPolling();
