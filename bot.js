require('dotenv/config');
const axios = require('axios');

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:5000/api';
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Deposit addresses (Kk controls these)
const DEPOSIT_ADDRESSES = {
  XLM: 'GCXKG6RNB4KSNTP5NNH7VWSSO2D7XW43YYZEBE47WYG7WRKOEZPR4M3N',  // Stellar
  ETH: '0x8B4a5d8679B66d3f5C7c7c6E2D5fB8aC3D9F1E4b',  // Ethereum
  BTC: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'   // Bitcoin
};

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

async function placeBet(userId, marketId, side, amount, paymentMethod) {
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

async function depositCrypto(userId, amount, currency) {
  try {
    const res = await axios.post(
      `${API_URL}/wallet/deposit`,
      { paymentMethod: currency, amount, currency },
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

function depositMenuKeyboard() {
  return JSON.stringify({
    inline_keyboard: [
      [{ text: '💎 XLM (Stellar) - FREE', callback_data: 'dep_XLM' }],
      [{ text: '⟐ ETH (Ethereum)', callback_data: 'dep_ETH' }],
      [{ text: '₿ BTC (Bitcoin)', callback_data: 'dep_BTC' }],
      [{ text: '🔙 Back to Wallet', callback_data: 'wallet' }]
    ]
  });
}

function depositXLMKeyboard() {
  return JSON.stringify({
    inline_keyboard: [
      [{ text: '✅ I Sent XLM', callback_data: 'dep_confirm_XLM' }],
      [{ text: '🔙 Cancel', callback_data: 'deposit_menu' }]
    ]
  });
}

function depositETHKeyboard() {
  return JSON.stringify({
    inline_keyboard: [
      [{ text: '✅ I Sent ETH', callback_data: 'dep_confirm_ETH' }],
      [{ text: '🔙 Cancel', callback_data: 'deposit_menu' }]
    ]
  });
}

function depositBTCKeyboard() {
  return JSON.stringify({
    inline_keyboard: [
      [{ text: '✅ I Sent BTC', callback_data: 'dep_confirm_BTC' }],
      [{ text: '🔙 Cancel', callback_data: 'deposit_menu' }]
    ]
  });
}

function marketsListKeyboard(markets) {
  const rows = markets.map(m => [{
    text: `${m.yesPrice >= 0.5 ? '🟢' : '🔴'} ${m.title.substring(0, 30)}...`,
    callback_data: `market_${m.id}`
  }]);
  rows.push([{ text: '🔙 Back to Menu', callback_data: 'menu' }]);
  return JSON.stringify({ inline_keyboard: rows });
}

function withdrawMenuKeyboard() {
  return JSON.stringify({
    inline_keyboard: [
      [{ text: '💎 Withdraw XLM', callback_data: 'withd_XLM' }],
      [{ text: '⟐ Withdraw ETH', callback_data: 'withd_ETH' }],
      [{ text: '₿ Withdraw BTC', callback_data: 'withd_BTC' }],
      [{ text: '🔙 Back to Wallet', callback_data: 'wallet' }]
    ]
  });
}

function withdrawConfirmKeyboard(currency) {
  return JSON.stringify({
    inline_keyboard: [
      [
        { text: '✅ Confirm Withdrawal', callback_data: `withd_confirm_${currency}` },
        { text: '❌ Cancel', callback_data: 'withdraw_menu' }
      ]
    ]
  });
}

// ============================================
// COMMAND HANDLERS
// ============================================

async function cmdStart(chatId, userId) {
  userStates.delete(userId);
  
  const balance = await getBalance(userId);
  
  const xlmBal = balance?.crypto?.XLM || 0;
  const ethBal = balance?.crypto?.ETH || 0;
  const btcBal = balance?.crypto?.BTC || 0;
  const mtnBal = balance?.mobileMoneyBalances?.find(b => b.provider === 'MTN')?.balance || 0;
  
  let msg = `🇬🇭 *Welcome to Newpot!*

Ghana's crypto prediction market.
Predict. Bet. Win.

━━━━━━━━━━━━━━━━━━
💼 *Your Balances*
💎 XLM: *${xlmBal.toFixed(2)}*
⟐ ETH: *${ethBal.toFixed(4)}*
₿ BTC: *${btcBal.toFixed(6)}*
📱 MTN: *GHS ${mtnBal.toFixed(2)}*
━━━━━━━━━━━━━━━━━━

*Select an option:*`;

  await sendMessage(chatId, msg, { reply_markup: mainMenu() });
}

async function showMarkets(chatId, userId) {
  const markets = await getMarkets();
  userStates.delete(userId);
  
  if (markets.length === 0) {
    await sendMessage(chatId, '📭 No markets available.');
    return;
  }

  let msg = `📊 *Active Markets*\nSelect a market to view odds:\n\n`;
  
  markets.forEach((m, i) => {
    const endDate = new Date(m.endDate);
    const days = Math.ceil((endDate - Date.now()) / (1000 * 60 * 60 * 24));
    const status = m.isResolved ? '✅' : '⏳';
    
    msg += `*${i + 1}.* ${m.title}\n`;
    msg += `   🟢 YES ${(m.yesPrice * 100).toFixed(0)}% | 🔴 NO ${(m.noPrice * 100).toFixed(0)}%\n`;
    msg += `   ${status} ${days > 0 ? days + 'd left' : 'ENDING'} | Vol: GHS ${(m.volume || 0).toLocaleString()}\n\n`;
  });

  await sendMessage(chatId, msg, { reply_markup: marketsListKeyboard(markets) });
}

async function showMarketDetail(chatId, userId, marketId) {
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
  const xlmBal = balance?.crypto?.XLM || 0;
  const ethBal = balance?.crypto?.ETH || 0;

  let msg = `📈 *${m.title}*\n\n`;
  msg += `${m.description}\n\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `🟢 *YES:* ${(m.yesPrice * 100).toFixed(1)}% — Win *${yesPayout}x*\n`;
  msg += `🔴 *NO:*  ${(m.noPrice * 100).toFixed(1)}% — Win *${noPayout}x*\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `📊 Volume: GHS ${(m.volume || 0).toLocaleString()}\n`;
  msg += `⏰ Settles: ${endDate.toLocaleDateString('en-GB')} (${days}d)\n\n`;
  msg += `💼 *Your balances:*\n`;
  msg += `   💎 XLM: ${xlmBal.toFixed(2)} | ⟐ ETH: ${ethBal.toFixed(4)}\n`;
  msg += `   📱 MTN: GHS ${mtnBal.toFixed(2)}\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `*Select your prediction:*`;

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

  await sendMessage(chatId, msg, { reply_markup: keyboard });
}

async function showBetAmount(chatId, userId, side, marketId) {
  const markets = await getMarkets();
  const m = markets.find(x => x.id === marketId);
  if (!m) return;

  const price = side === 'YES' ? m.yesPrice : m.noPrice;
  const balance = await getBalance(userId);
  const mtnBal = balance?.mobileMoneyBalances?.find(b => b.provider === 'MTN')?.balance || 0;
  const xlmBal = balance?.crypto?.XLM || 0;
  const ethBal = balance?.crypto?.ETH || 0;

  // Store user's bet intent
  userStates.set(userId, { action: 'betting', marketId, side, price });

  const emoji = side === 'YES' ? '🟢' : '🔴';
  
  let msg = `${emoji} *Bet on ${side}*\n\n`;
  msg += `📊 Market: ${m.title}\n`;
  msg += `💰 Odds: ${(price * 100).toFixed(1)}%\n\n`;
  msg += `*Select payment currency:*\n`;
  msg += `💎 XLM: ${xlmBal.toFixed(2)}\n`;
  msg += `⟐ ETH: ${ethBal.toFixed(4)}\n`;
  msg += `📱 MTN: GHS ${mtnBal.toFixed(2)}\n\n`;
  msg += `*Select amount in GHS equivalent:*`;

  await sendMessage(chatId, msg, {
    reply_markup: JSON.stringify({
      inline_keyboard: [
        [
          { text: `💎 XLM (${Math.floor(xlmBal)} available)`, callback_data: `pay_XLM_${marketId}_${side}` },
        ],
        [
          { text: `⟐ ETH (${ethBal.toFixed(4)} available)`, callback_data: `pay_ETH_${marketId}_${side}` },
        ],
        [
          { text: `📱 MTN GHS (${mtnBal.toFixed(2)} available)`, callback_data: `pay_MTN_${marketId}_${side}` },
        ],
        [{ text: '❌ Cancel', callback_data: `market_${marketId}` }]
      ]
    })
  });
}

async function showBetAmountForCurrency(chatId, userId, currency, marketId, side) {
  const markets = await getMarkets();
  const m = markets.find(x => x.id === marketId);
  if (!m) return;

  const price = side === 'YES' ? m.yesPrice : m.noPrice;
  const balance = await getBalance(userId);
  let available = 0;
  
  if (currency === 'XLM') available = balance?.crypto?.XLM || 0;
  else if (currency === 'ETH') available = balance?.crypto?.ETH || 0;
  else if (currency === 'MTN') available = balance?.mobileMoneyBalances?.find(b => b.provider === 'MTN')?.balance || 0;
  else if (currency === 'BTC') available = balance?.crypto?.BTC || 0;

  userStates.set(userId, { action: 'betting', marketId, side, price, currency });

  const emoji = side === 'YES' ? '🟢' : '🔴';
  const currencySymbol = currency === 'XLM' ? '💎' : currency === 'ETH' ? '⟐' : currency === 'BTC' ? '₿' : '📱';
  
  let msg = `${emoji} *Bet ${side} — Paying with ${currency}*\n\n`;
  msg += `📊 Market: ${m.title}\n`;
  msg += `💰 Odds: ${(price * 100).toFixed(1)}%\n`;
  msg += `${currencySymbol} Available: ${available.toFixed(currency === 'XLM' ? 2 : 4)}\n\n`;
  msg += `*Select stake amount:*`;

  await sendMessage(chatId, msg, {
    reply_markup: JSON.stringify({
      inline_keyboard: [
        [{ text: '10 GHS', callback_data: `bet_${marketId}_${side}_${currency}_10` }, { text: '25 GHS', callback_data: `bet_${marketId}_${side}_${currency}_25` }, { text: '50 GHS', callback_data: `bet_${marketId}_${side}_${currency}_50` }],
        [{ text: '100 GHS', callback_data: `bet_${marketId}_${side}_${currency}_100` }, { text: '200 GHS', callback_data: `bet_${marketId}_${side}_${currency}_200` }],
        [{ text: '💬 Enter Custom', callback_data: `bet_custom_${marketId}_${side}_${currency}` }],
        [{ text: '❌ Cancel', callback_data: `market_${marketId}` }]
      ]
    })
  });
}

async function executeBet(chatId, userId, marketId, side, currency, amountGHS) {
  const balance = await getBalance(userId);
  let available = 0;
  
  if (currency === 'XLM') available = balance?.crypto?.XLM || 0;
  else if (currency === 'ETH') available = balance?.crypto?.ETH || 0;
  else if (currency === 'BTC') available = balance?.crypto?.BTC || 0;
  else if (currency === 'MTN') available = balance?.mobileMoneyBalances?.find(b => b.provider === 'MTN')?.balance || 0;
  
  // For MVP: use GHS amount as proxy for crypto amount (simplified)
  // In production: convert GHS to crypto at current price
  const amount = amountGHS;

  if (available < amount) {
    const currencySymbol = currency === 'XLM' ? '💎' : currency === 'ETH' ? '⟐' : currency === 'BTC' ? '₿' : '📱';
    await sendMessage(chatId, `❌ *Insufficient ${currency} balance*\n\n${currencySymbol} Your ${currency}: ${available.toFixed(2)}\nRequired: ${amount.toFixed(2)}\n\nDeposit first: /deposit`, {
      reply_markup: mainMenu()
    });
    return;
  }

  const result = await placeBet(userId, marketId, side, amount, currency);
  
  if (!result.success) {
    await sendMessage(chatId, `❌ *Bet failed*\n\n${result.error?.message || 'Unknown error'}`, {
      reply_markup: mainMenu()
    });
    return;
  }

  const markets = await getMarkets();
  const m = markets.find(x => x.id === marketId);
  const emoji = side === 'YES' ? '🟢' : '🔴';

  let msg = `✅ *Bet Placed!*\n\n`;
  msg += `${emoji} *${side}* on: ${m?.title || 'Market'}\n`;
  msg += `💵 Stake: ${amount.toFixed(2)} ${currency}\n`;
  msg += `📊 Shares: ${result.data?.user_shares || 'N/A'}\n`;
  msg += `💰 Potential payout: *${(result.data?.user_shares * 0.97 || 0).toFixed(2)} ${currency}*\n`;
  msg += `_3% house fee_`;

  await sendMessage(chatId, msg, { reply_markup: mainMenu() });

  // Alert owner
  if (OWNER_CHAT_ID && OWNER_CHAT_ID !== String(chatId)) {
    await sendMessage(OWNER_CHAT_ID, `💰 *New bet!*
User ${userId}
${amount} ${currency} on ${side} → Market [${marketId}]`);
  }
}

async function showDeposit(chatId, userId) {
  userStates.delete(userId);
  
  let msg = `💰 *Deposit Crypto*\n\n`;
  msg += `Send crypto to deposit into your Newpot wallet.\n`;
  msg += `*Min deposit:* 10 XLM / 0.01 ETH / 0.001 BTC\n\n`;
  msg += `*Select cryptocurrency:*`;

  await sendMessage(chatId, msg, { reply_markup: depositMenuKeyboard() });
}

async function showDepositAddress(chatId, userId, currency) {
  const address = DEPOSIT_ADDRESSES[currency];
  const balance = await getBalance(userId);
  let currentBal = 0;
  
  if (currency === 'XLM') currentBal = balance?.crypto?.XLM || 0;
  else if (currency === 'ETH') currentBal = balance?.crypto?.ETH || 0;
  else if (currency === 'BTC') currentBal = balance?.crypto?.BTC || 0;

  const symbols = { XLM: '💎', ETH: '⟐', BTC: '₿' };
  const explorer = {
    XLM: 'https://stellar.expert/explorer/public/account/',
    ETH: 'https://etherscan.io/address/',
    BTC: 'https://blockstream.info/address/'
  };

  let msg = `💰 *Deposit ${currency}*\n\n`;
  msg += `Send *${currency}* to this address:\n\n`;
  msg += `📋 \`${address}\`\n\n`;
  msg += `_Or tap address to copy_\n\n`;
  msg += `⏱️ *Processing:* ~5 min (XLM ~1 min)\n`;
  msg += `💎 Current balance: ${currentBal.toFixed(currency === 'XLM' ? 2 : 4)} ${currency}\n\n`;
  msg += `*After sending, tap "I Sent ${currency}" to credit your account*`;

  let keyboard;
  if (currency === 'XLM') keyboard = depositXLMKeyboard();
  else if (currency === 'ETH') keyboard = depositETHKeyboard();
  else keyboard = depositBTCKeyboard();

  await sendMessage(chatId, msg, { reply_markup: keyboard });
}

async function confirmDeposit(chatId, userId, currency) {
  // In production: check blockchain for tx
  // For MVP: credit a demo amount
  const demoAmounts = { XLM: 100, ETH: 0.05, BTC: 0.001 };
  const amount = demoAmounts[currency];
  
  const result = await depositCrypto(userId, amount, currency);
  
  if (result.success) {
    const balance = await getBalance(userId);
    let newBal = 0;
    if (currency === 'XLM') newBal = balance?.crypto?.XLM || 0;
    else if (currency === 'ETH') newBal = balance?.crypto?.ETH || 0;
    else if (currency === 'BTC') newBal = balance?.crypto?.BTC || 0;

    let msg = `✅ *${currency} Deposited!*\n\n`;
    msg += `💎 +${amount} ${currency} credited\n`;
    msg += `💼 New balance: *${newBal.toFixed(currency === 'XLM' ? 2 : 4)} ${currency}*\n\n`;
    msg += `_Ready to place bets!_`;

    await sendMessage(chatId, msg, { reply_markup: mainMenu() });
  } else {
    await sendMessage(chatId, `❌ Deposit failed. Try again or contact support.`, {
      reply_markup: mainMenu()
    });
  }
}

async function showWithdrawAddress(chatId, userId, currency) {
  userStates.set(userId, { action: 'withdraw', currency });
  
  const balance = await getBalance(userId);
  let available = 0;
  
  if (currency === 'XLM') available = balance?.crypto?.XLM || 0;
  else if (currency === 'ETH') available = balance?.crypto?.ETH || 0;
  else if (currency === 'BTC') available = balance?.crypto?.BTC || 0;

  let msg = `📤 *Withdraw ${currency}*\n\n`;
  msg += `💎 Available: *${available.toFixed(currency === 'XLM' ? 2 : 4)} ${currency}*\n\n`;
  msg += `Send your ${currency} address:\n`;
  msg += `_Reply with your wallet address_`;

  await sendMessage(chatId, msg);
}

async function showWallet(chatId, userId) {
  const balance = await getBalance(userId);
  
  const xlmBal = balance?.crypto?.XLM || 0;
  const ethBal = balance?.crypto?.ETH || 0;
  const btcBal = balance?.crypto?.BTC || 0;
  const mtnBal = balance?.mobileMoneyBalances?.find(b => b.provider === 'MTN')?.balance || 0;
  
  let msg = `💼 *Your Wallet*\n\n`;
  msg += `💎 *XLM:* ${xlmBal.toFixed(2)}\n`;
  msg += `⟐ *ETH:* ${ethBal.toFixed(6)}\n`;
  msg += `₿ *BTC:* ${btcBal.toFixed(6)}\n`;
  msg += `📱 *MTN:* GHS ${mtnBal.toFixed(2)}\n`;
  msg += `\n_USDT/USDC coming soon_`;

  await sendMessage(chatId, msg, { reply_markup: walletKeyboard() });
}

async function showPortfolio(chatId, userId) {
  const positions = await getPortfolio(userId);
  const markets = await getMarkets();

  if (positions.length === 0) {
    await sendMessage(chatId, `📭 *No positions yet*\n\n/markets to start trading!`, {
      reply_markup: mainMenu()
    });
    return;
  }

  let msg = `📈 *Your Portfolio*\n${positions.length} positions:\n\n`;
  let totalPnl = 0;

  for (const pos of positions) {
    const m = markets.find(x => x.id === pos.marketId);
    const title = m ? m.title.substring(0, 25) : `Market ${pos.marketId}`;
    const emoji = pos.side === 'YES' ? '🟢' : '🔴';
    
    msg += `${emoji} *${pos.side}* — ${title}\n`;
    msg += `   Stake: ${pos.amount} ${pos.paymentMethod} | P&L: ${pos.amount >= pos.amount ? '+' : ''}${0}\n\n`;
    totalPnl += 0; // Simplified for MVP
  }

  msg += `\n_Real-time P&L coming soon_`;
  await sendMessage(chatId, msg, { reply_markup: mainMenu() });
}

async function showHelp(chatId) {
  let msg = `📖 *Newpot Help*\n\n`;
  msg += `*How to trade:*\n`;
  msg += `1. 💰 Deposit XLM/ETH/BTC\n`;
  msg += `2. 📊 Browse /markets\n`;
  msg += `3. 🟢🔴 Pick YES or NO\n`;
  msg += `4. 💵 Enter stake\n`;
  msg += `5. ✅ Confirm bet!\n\n`;
  msg += `*Payout:* Correct prediction wins!\n`;
  msg += `_3% house fee at settlement_\n\n`;
  msg += `*Commands:*\n`;
  msg += `/start — Main menu\n`;
  msg += `/markets — Browse markets\n`;
  msg += `/deposit — Add crypto\n`;
  msg += `/balance — Check wallet\n`;
  msg += `/portfolio — Your positions`;

  await sendMessage(chatId, msg, { reply_markup: mainMenu() });
}

// ============================================
// CALLBACK HANDLER
// ============================================

async function handleCallback(chatId, userId, queryId, data) {
  const parts = data.split('_');
  const action = parts[0];

  await answerCallback(queryId, '');

  if (action === 'menu') {
    await cmdStart(chatId, userId);
  }
  else if (action === 'all_markets') {
    await showMarkets(chatId, userId);
  }
  else if (action === 'market') {
    await showMarketDetail(chatId, userId, parts[1]);
  }
  else if (action === 'side') {
    await showBetAmount(chatId, userId, parts[1], parts[2]);
  }
  else if (action === 'pay') {
    await showBetAmountForCurrency(chatId, userId, parts[1], parts[2], parts[3]);
  }
  else if (action === 'bet') {
    const marketId = parts[1];
    const side = parts[2];
    const currency = parts[3];
    const amount = parseFloat(parts[4]);
    await executeBet(chatId, userId, marketId, side, currency, amount);
  }
  else if (action === 'bet_custom') {
    // Store state and prompt for amount
    const marketId = parts[1];
    const side = parts[2];
    const currency = parts[3];
    userStates.set(userId, { action: 'custom_bet', marketId, side, currency });
    await sendMessage(chatId, `💬 *Enter custom amount in GHS:*\n\n_Reply with a number (e.g., 75)_`, {
      reply_markup: JSON.stringify({
        inline_keyboard: [[{ text: '❌ Cancel', callback_data: `market_${marketId}` }]]
      })
    });
  }
  else if (action === 'dep' && parts[1]) {
    const currency = parts[1];
    if (currency === 'menu') {
      await showDeposit(chatId, userId);
    } else {
      await showDepositAddress(chatId, userId, currency);
    }
  }
  else if (action === 'dep_confirm') {
    const currency = parts[1];
    await confirmDeposit(chatId, userId, currency);
  }
  else if (action === 'deposit_menu') {
    await showDeposit(chatId, userId);
  }
  else if (action === 'wallet') {
    await showWallet(chatId, userId);
  }
  else if (action === 'withdraw_menu') {
    await showWithdrawAddress(chatId, userId, 'XLM');
  }
  else if (action === 'withd' && parts[1]) {
    const currency = parts[1];
    await showWithdrawAddress(chatId, userId, currency);
  }
  else if (action === 'portfolio') {
    await showPortfolio(chatId, userId);
  }
  else {
    await sendMessage(chatId, 'Unknown action. Type /help');
  }
}

// ============================================
// MESSAGE HANDLER
// ============================================

async function handleMessage(message) {
  const chatId = message.chat.id;
  const userId = String(message.from.id);
  const text = message.text || '';

  // Check user state for multi-step flows
  const state = userStates.get(userId);

  if (state?.action === 'custom_bet') {
    const amount = parseFloat(text);
    if (!isNaN(amount) && amount > 0) {
      userStates.delete(userId);
      await executeBet(chatId, userId, state.marketId, state.side, state.currency, amount);
    } else {
      await sendMessage(chatId, '❌ Invalid amount. Enter a number.');
    }
    return;
  }

  if (state?.action === 'withdraw') {
    // Validate address format (simplified)
    if (text.length > 20) {
      userStates.delete(userId);
      await sendMessage(chatId, `📤 *Withdrawal requested*\n\n${state.currency} will be sent to:\n\`${text}\`\n\nProcessing time: 1-24 hours.\n\n_Contact @newpot_support for issues_`, {
        reply_markup: mainMenu()
      });
    } else {
      await sendMessage(chatId, '❌ Invalid address. Please enter a valid wallet address.');
    }
    return;
  }

  // Commands
  if (text === '/start') await cmdStart(chatId, userId);
  else if (text === '/markets' || text === '/market') await showMarkets(chatId, userId);
  else if (text.startsWith('/odds')) {
    const id = text.split(' ')[1];
    if (id) await showMarketDetail(chatId, userId, id);
  }
  else if (text === '/deposit') await showDeposit(chatId, userId);
  else if (text === '/balance' || text === '/wallet') await showWallet(chatId, userId);
  else if (text === '/portfolio' || text === '/port') await showPortfolio(chatId, userId);
  else if (text === '/help') await showHelp(chatId);
}

// ============================================
// POLLING
// ============================================

async function startPolling() {
  let offset = 0;
  console.log('🔄 Newpot Bot polling (crypto mode)...');

  while (true) {
    try {
      const res = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`, {
        params: { offset: offset + 1, timeout: 30 }
      });

      for (const update of res.data.result || []) {
        offset = update.update_id;

        if (update.callback_query) {
          const cb = update.callback_query;
          await handleCallback(cb.message.chat.id, String(cb.from.id), cb.id, cb.data);
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

console.log('🚀 Newpot Crypto Bot starting...');
console.log(`📡 API: ${API_URL}`);
console.log('💎 XLM deposit:', DEPOSIT_ADDRESSES.XLM.substring(0, 20) + '...');
console.log('⟐ ETH deposit:', DEPOSIT_ADDRESSES.ETH.substring(0, 20) + '...');

startPolling();
