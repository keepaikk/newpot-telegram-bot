require('dotenv/config');
const axios = require('axios');

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:5000/api';
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Kk's Stellar deposit address for USDC
// USDC on Stellar: CAOAL4BPMWQBPQDSUM2LL4WWVLLM56OHTLSSSJU2HPBI3Z2Z6R3Z4BCJ
// Kk's actual XLM address (2026-03-25)
const STELLAR_ADDRESS = process.env.STELLAR_ADDRESS || 'GB7B3CQJD5L7OX5KGMV6HMZ5Z7EB4CRPITQDG4MK4FZTQW34CU2GZQGZ';

// USDC on Stellar - this is Circle's USDC issuer
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZCH';
const USDC_ASSET = 'USDC';

const DEPOSIT_ADDRESSES = {
  USDC_STELLAR: STELLAR_ADDRESS,
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

async function depositUSDC(userId, amount) {
  try {
    const res = await axios.post(
      `${API_URL}/wallet/deposit`,
      { paymentMethod: 'USDC', amount, currency: 'USDC' },
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
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: opts.parse_mode || 'Markdown',
      reply_markup: opts.reply_markup,
      disable_web_page_preview: true
    });
  } catch (err) {
    console.error('Send error:', err.message);
  }
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
      [{ text: '📊 Markets' }, { text: '💰 Deposit' }],
      [{ text: '💼 Wallet' }, { text: '📈 Portfolio' }]
    ],
    resize_keyboard: true
  });
}

function walletKeyboard() {
  return JSON.stringify({
    inline_keyboard: [
      [{ text: '💰 Deposit USDC', callback_data: 'deposit_menu' }],
      [{ text: '📤 Withdraw USDC', callback_data: 'withdraw_menu' }],
      [{ text: '🔙 Back to Menu', callback_data: 'menu' }]
    ]
  });
}

function depositMenuKeyboard() {
  return JSON.stringify({
    inline_keyboard: [
      [{ text: '💵 Deposit USDC (Stellar)', callback_data: 'dep_stellar' }],
      [{ text: '🔙 Back to Wallet', callback_data: 'wallet' }]
    ]
  });
}

function depositConfirmKeyboard() {
  return JSON.stringify({
    inline_keyboard: [
      [{ text: '✅ I Sent USDC', callback_data: 'dep_confirm' }],
      [{ text: '❌ Cancel', callback_data: 'menu' }]
    ]
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

function withdrawMenuKeyboard() {
  return JSON.stringify({
    inline_keyboard: [
      [{ text: '📤 Withdraw to Bank (MoMo)', callback_data: 'withd_momo' }],
      [{ text: '📤 Withdraw to Stellar Wallet', callback_data: 'withd_stellar' }],
      [{ text: '🔙 Back to Wallet', callback_data: 'wallet' }]
    ]
  });
}

// ============================================
// COMMAND HANDLERS
// ============================================

async function cmdStart(chatId, userId) {
  userStates.delete(userId);
  
  const balance = await getBalance(userId);
  const usdcBal = balance?.crypto?.XLM || 0; // Using XLM slot for USDC in MVP
  
  let msg = `🇬🇭 *Newpot - Ghana's Prediction Market*

Predict African outcomes.
Win in US Dollars.

━━━━━━━━━━━━━━━━━━
💰 *Balance:* $${usdcBal.toFixed(2)} USDC
━━━━━━━━━━━━━━━━━━

*Choose an option:*`;

  await sendMessage(chatId, msg, { reply_markup: mainMenu() });
}

async function showMarkets(chatId, userId) {
  const markets = await getMarkets();
  userStates.delete(userId);
  
  if (markets.length === 0) {
    await sendMessage(chatId, '📭 No markets yet. Check back soon!');
    return;
  }

  let msg = `📊 *Active Markets*\nSelect a market to bet:\n\n`;
  
  markets.forEach((m, i) => {
    const endDate = new Date(m.endDate);
    const days = Math.ceil((endDate - Date.now()) / (1000 * 60 * 60 * 24));
    const status = m.isResolved ? '✅' : '⏳';
    
    msg += `*${i + 1}.* ${m.title}\n`;
    msg += `   🟢 YES ${(m.yesPrice * 100).toFixed(0)}% | 🔴 NO ${(m.noPrice * 100).toFixed(0)}%\n`;
    msg += `   ${status} ${days > 0 ? days + 'd left' : 'ENDING'} | Vol: $${(m.volume || 0).toLocaleString()}\n\n`;
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
  const usdcBal = balance?.crypto?.XLM || 0;

  let msg = `📈 *${m.title}*\n\n`;
  msg += `${m.description}\n\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `🟢 *YES:* ${(m.yesPrice * 100).toFixed(1)}% → Win *$${yesPayout}* per $1\n`;
  msg += `🔴 *NO:*  ${(m.noPrice * 100).toFixed(1)}% → Win *$${noPayout}* per $1\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `📊 Volume: $${(m.volume || 0).toLocaleString()}\n`;
  msg += `⏰ Settles: ${endDate.toLocaleDateString('en-GB')} (${days}d)\n`;
  msg += `💰 Balance: *$${usdcBal.toFixed(2)} USDC*\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `*Select your prediction:*`;

  const keyboard = JSON.stringify({
    inline_keyboard: [
      [
        { text: `🟢 BET YES — $${yesPayout}x`, callback_data: `side_YES_${m.id}` },
        { text: `🔴 BET NO — $${noPayout}x`, callback_data: `side_NO_${m.id}` }
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
  const usdcBal = balance?.crypto?.XLM || 0;

  userStates.set(userId, { action: 'betting', marketId, side, price });

  const emoji = side === 'YES' ? '🟢' : '🔴';
  
  let msg = `${emoji} *Bet on ${side}*\n\n`;
  msg += `📊 Market: ${m.title}\n`;
  msg += `💰 Odds: ${(price * 100).toFixed(1)}% → $${(1/price).toFixed(2)} per $1\n`;
  msg += `💰 Balance: $${usdcBal.toFixed(2)} USDC\n\n`;
  msg += `*Select bet amount:*`;

  await sendMessage(chatId, msg, {
    reply_markup: JSON.stringify({
      inline_keyboard: [
        [{ text: '$5 USDC', callback_data: `bet_${marketId}_${side}_5` }, { text: '$10 USDC', callback_data: `bet_${marketId}_${side}_10` }, { text: '$25 USDC', callback_data: `bet_${marketId}_${side}_25` }],
        [{ text: '$50 USDC', callback_data: `bet_${marketId}_${side}_50` }, { text: '$100 USDC', callback_data: `bet_${marketId}_${side}_100` }],
        [{ text: '$200 USDC', callback_data: `bet_${marketId}_${side}_200` }],
        [{ text: '💬 Custom Amount', callback_data: `bet_custom_${marketId}_${side}` }],
        [{ text: '❌ Cancel', callback_data: `market_${marketId}` }]
      ]
    })
  });
}

async function executeBet(chatId, userId, marketId, side, amountUSDC) {
  const balance = await getBalance(userId);
  const usdcBal = balance?.crypto?.XLM || 0; // USDC stored in XLM slot for MVP
  
  if (usdcBal < amountUSDC) {
    await sendMessage(chatId, `❌ *Insufficient balance*\n\n💰 Your balance: $${usdcBal.toFixed(2)} USDC\nBet amount: $${amountUSDC.toFixed(2)} USDC\n\nDeposit first: /deposit`, {
      reply_markup: mainMenu()
    });
    return;
  }

  const result = await placeBet(userId, marketId, side, amountUSDC, 'XLM'); // XLM = USDC in MVP
  
  if (!result.success) {
    await sendMessage(chatId, `❌ *Bet failed*\n\n${result.error?.message || 'Unknown error'}`, {
      reply_markup: mainMenu()
    });
    return;
  }

  const markets = await getMarkets();
  const m = markets.find(x => x.id === marketId);
  const emoji = side === 'YES' ? '🟢' : '🔴';
  const payout = (amountUSDC / (side === 'YES' ? m.yesPrice : m.noPrice) * 0.97).toFixed(2);

  let msg = `✅ *Bet Placed!*\n\n`;
  msg += `${emoji} *${side}* on: ${m?.title?.substring(0, 40) || 'Market'}\n`;
  msg += `💵 Stake: *$${amountUSDC.toFixed(2)} USDC*\n`;
  msg += `📊 Odds: ${(side === 'YES' ? m.yesPrice : m.noPrice) * 100}%\n`;
  msg += `💰 Potential payout: *$${payout} USDC*\n`;
  msg += `_3% house fee applied at settlement_`;

  await sendMessage(chatId, msg, { reply_markup: mainMenu() });

  // Alert owner
  if (OWNER_CHAT_ID && OWNER_CHAT_ID !== String(chatId)) {
    await sendMessage(OWNER_CHAT_ID, `💰 *New bet!*
User ${userId}
$${amountUSDC} USDC on ${side}
Market [${marketId}]
Payout: $${payout}`);
  }
}

async function showDeposit(chatId, userId) {
  userStates.delete(userId);
  
  const balance = await getBalance(userId);
  const usdcBal = balance?.crypto?.XLM || 0;

  let msg = `💰 *Deposit USDC*\n\n`;
  msg += `Send USDC (Stablecoin) via Stellar network.\n`;
  msg += `What you send = what you get. No volatility.\n\n`;
  msg += `*Network:* Stellar (XLM) — FREE, ~5 seconds\n`;
  msg += `*Asset:* USDC (Circle)\n\n`;
  msg += `📋 *Your deposit address:*\n`;
  msg += `\`${DEPOSIT_ADDRESSES.USDC_STELLAR}\`\n\n`;
  msg += `⚠️ *IMPORTANT - Set memo:*\n`;
  msg += `When sending, set the *memo* to:\n`;
  msg += `\`${userId}\`\n\n`;
  msg += `_This identifies your deposit_\n\n`;
  msg += `💰 Current balance: $${usdcBal.toFixed(2)} USDC`;

  await sendMessage(chatId, msg, { reply_markup: depositConfirmKeyboard() });
}

async function confirmDeposit(chatId, userId) {
  // In production: verify on-chain with Stellar API
  // For MVP: credit demo amount
  const demoAmount = 50; // $50 demo credit
  
  const result = await depositUSDC(userId, demoAmount);
  
  if (result.success) {
    const balance = await getBalance(userId);
    const usdcBal = balance?.crypto?.XLM || 0;

    let msg = `✅ *USDC Deposited! (Demo)*\n\n`;
    msg += `💰 +$${demoAmount.toFixed(2)} USDC credited\n`;
    msg += `💰 Balance: *$${usdcBal.toFixed(2)} USDC*\n\n`;
    msg += `_(Real deposits: send USDC via Stellar to the address above)_\n\n`;
    msg += `_Ready to place bets!_`;

    await sendMessage(chatId, msg, { reply_markup: mainMenu() });
  } else {
    await sendMessage(chatId, `❌ Deposit failed.`, { reply_markup: mainMenu() });
  }
}

async function showWithdraw(chatId, userId) {
  const balance = await getBalance(userId);
  const usdcBal = balance?.crypto?.XLM || 0;

  if (usdcBal < 1) {
    await sendMessage(chatId, `❌ *Minimum withdrawal: $1 USDC*\n\nYour balance: $${usdcBal.toFixed(2)} USDC`, {
      reply_markup: mainMenu()
    });
    return;
  }

  let msg = `📤 *Withdraw USDC*\n\n`;
  msg += `💰 Available: *$${usdcBal.toFixed(2)} USDC*\n\n`;
  msg += `*Choose withdrawal method:*`;

  await sendMessage(chatId, msg, { reply_markup: withdrawMenuKeyboard() });
}

async function showWallet(chatId, userId) {
  const balance = await getBalance(userId);
  const usdcBal = balance?.crypto?.XLM || 0;
  const mtnBal = balance?.mobileMoneyBalances?.find(b => b.provider === 'MTN')?.balance || 0;

  let msg = `💼 *Your Wallet*\n\n`;
  msg += `💵 *USDC (Stellar):* $${usdcBal.toFixed(2)}\n`;
  if (mtnBal > 0) msg += `📱 *MTN MoMo:* GHS ${mtnBal.toFixed(2)}\n`;
  msg += `\n_1 USDC ≈ $1 USD (stable)_`;

  await sendMessage(chatId, msg, { reply_markup: walletKeyboard() });
}

async function showPortfolio(chatId, userId) {
  const positions = await getPortfolio(userId);
  const markets = await getMarkets();

  if (positions.length === 0) {
    await sendMessage(chatId, `📭 *No positions yet*\n\n/markets to start predicting!`, {
      reply_markup: mainMenu()
    });
    return;
  }

  let msg = `📈 *Your Portfolio*\n${positions.length} positions:\n\n`;
  let totalStaked = 0;

  for (const pos of positions) {
    const m = markets.find(x => x.id === pos.marketId);
    const title = m ? m.title.substring(0, 30) : `Market ${pos.marketId}`;
    const emoji = pos.side === 'YES' ? '🟢' : '🔴';
    
    msg += `${emoji} *${pos.side}* — ${title}\n`;
    msg += `   💵 $${pos.amount.toFixed(2)} USDC staked\n\n`;
    totalStaked += pos.amount;
  }

  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `💵 Total staked: $${totalStaked.toFixed(2)} USDC`;
  msg += `\n━━━━━━━━━━━━━━━━━━`;

  await sendMessage(chatId, msg, { reply_markup: mainMenu() });
}

async function showHelp(chatId) {
  let msg = `📖 *Newpot Guide*\n\n`;
  msg += `*How to predict:*\n`;
  msg += `1. 💰 Deposit USDC (Stellar)\n`;
  msg += `2. 📊 Pick a market\n`;
  msg += `3. 🟢🔴 Choose YES or NO\n`;
  msg += `4. 💵 Enter stake amount\n`;
  msg += `5. ✅ Win if correct!\n\n`;
  msg += `*Payout:*\n`;
  msg += `Stake × Odds = Your win\n`;
  msg += `_3% house fee at settlement_\n\n`;
  msg += `*Why USDC?*\n`;
  msg += `Stable — same value as USD.\n`;
  msg += `No crypto price swings.\n\n`;
  msg += `*Commands:*\n`;
  msg += `/start — Main menu\n`;
  msg += `/markets — Browse markets\n`;
  msg += `/deposit — Add USDC\n`;
  msg += `/wallet — Check balances\n`;
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

  if (action === 'menu') await cmdStart(chatId, userId);
  else if (action === 'all_markets') await showMarkets(chatId, userId);
  else if (action === 'market') await showMarketDetail(chatId, userId, parts[1]);
  else if (action === 'side') await showBetAmount(chatId, userId, parts[1], parts[2]);
  else if (action === 'bet') {
    const [,, marketId, side, amount] = parts;
    await executeBet(chatId, userId, marketId, side, parseFloat(amount));
  }
  else if (action === 'bet_custom') {
    const [,, marketId, side] = parts;
    userStates.set(userId, { action: 'custom_bet', marketId, side });
    await sendMessage(chatId, `💬 *Enter custom amount in USDC:*\n\n_Reply with a number (e.g., 75)_`);
  }
  else if (action === 'deposit_menu') await showDeposit(chatId, userId);
  else if (action === 'dep_stellar') await showDeposit(chatId, userId);
  else if (action === 'dep_confirm') await confirmDeposit(chatId, userId);
  else if (action === 'wallet') await showWallet(chatId, userId);
  else if (action === 'withdraw_menu') await showWithdraw(chatId, userId);
  else if (action === 'withd_momo') {
    userStates.set(userId, { action: 'withdraw', method: 'momo' });
    await sendMessage(chatId, `📤 *Withdraw to MoMo*\n\nSend your MoMo number:\n\n_Reply with phone number (e.g., 0201234567)_`);
  }
  else if (action === 'withd_stellar') {
    userStates.set(userId, { action: 'withdraw', method: 'stellar' });
    await sendMessage(chatId, `📤 *Withdraw to Stellar*\n\nSend your Stellar address:\n\n_Reply with your Stellar wallet address_`);
  }
  else if (action === 'portfolio') await showPortfolio(chatId, userId);
  else await sendMessage(chatId, 'Unknown action. Type /help');
}

// ============================================
// MESSAGE HANDLER
// ============================================

async function handleMessage(message) {
  const chatId = message.chat.id;
  const userId = String(message.from.id);
  const text = message.text || '';
  const state = userStates.get(userId);

  if (state?.action === 'custom_bet') {
    const amount = parseFloat(text);
    if (!isNaN(amount) && amount >= 1) {
      userStates.delete(userId);
      await executeBet(chatId, userId, state.marketId, state.side, amount);
    } else {
      await sendMessage(chatId, '❌ Minimum bet is $1 USDC. Enter a valid number.');
    }
    return;
  }

  if (state?.action === 'withdraw') {
    userStates.delete(userId);
    const balance = await getBalance(userId);
    const usdcBal = balance?.crypto?.XLM || 0;
    
    let msg = `📤 *Withdrawal Requested*\n\n`;
    msg += `Amount: $${usdcBal.toFixed(2)} USDC\n`;
    if (state.method === 'momo') {
      msg += `To: MoMo ${text}\n`;
      msg += `_Processing: 24-48 hours_`;
    } else {
      msg += `To: ${text.substring(0, 20)}...\n`;
      msg += `_Processing: ~5 minutes (Stellar)_`;
    }
    
    await sendMessage(chatId, msg, { reply_markup: mainMenu() });
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

  // Keyboard button presses (they send text as messages)
  else if (text === '📊 Markets' || text === 'Markets') await showMarkets(chatId, userId);
  else if (text === '💰 Deposit' || text === 'Deposit') await showDeposit(chatId, userId);
  else if (text === '💼 Wallet' || text === 'Wallet') await showWallet(chatId, userId);
  else if (text === '📈 Portfolio' || text === 'Portfolio') await showPortfolio(chatId, userId);
  else if (text === '❓ Help' || text === 'Help') await showHelp(chatId);
}

// ============================================
// POLLING
// ============================================

async function startPolling() {
  let offset = 0;
  console.log('🔄 Newpot USDC Bot polling...');

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

console.log('🚀 Newpot USDC Bot starting...');
console.log(`📡 API: ${API_URL}`);
console.log(`📬 Deposit address: ${DEPOSIT_ADDRESSES.USDC_STELLAR.substring(0, 20)}...`);

startPolling();
