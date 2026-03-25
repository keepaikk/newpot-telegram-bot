require('dotenv/config');
const { Telegraf, Markup } = require('telegraf');

// Markets data (mirrors frontend constants)
const MARKETS = [
  {
    id: '1',
    title: 'Will Ghana win AFCON 2027?',
    category: 'Sports',
    endDate: '2027-02-28',
    yesPrice: 0.38,
    noPrice: 0.62,
    volume: 89000
  },
  {
    id: '2',
    title: 'Will NPP win the 2028 Ghana Presidential Election?',
    category: 'Politics',
    endDate: '2028-12-07',
    yesPrice: 0.51,
    noPrice: 0.49,
    volume: 3200000
  },
  {
    id: '3',
    title: 'Will BTC exceed $150,000 by end of 2026?',
    category: 'Crypto',
    endDate: '2026-12-31',
    yesPrice: 0.65,
    noPrice: 0.35,
    volume: 1250000
  },
  {
    id: '4',
    title: 'Will Ghana inflation drop below 10% by Q3 2026?',
    category: 'Economy',
    endDate: '2026-09-30',
    yesPrice: 0.42,
    noPrice: 0.58,
    volume: 45000
  }
];

// In-memory user store (MVP)
const users = {};
const positions = {};

const bot = new Telegraf(process.env.BOT_TOKEN);

// Format currency
const formatVol = (v) => v >= 1000000 ? `$${(v/1000000).toFixed(1)}M` : v >= 1000 ? `$${(v/1000).toFixed(0)}K` : `$${v}`;

// Start
bot.start((ctx) => {
  const userId = ctx.from.id.toString();
  users[userId] = { ...users[userId], id: userId, name: ctx.from.first_name };
  ctx.reply(`🇬🇭 *Newpot Africa*

Welcome, ${ctx.from.first_name}!

Ghana's crypto prediction markets. Bet on politics, sports, crypto and more.

Use /markets to see active markets.`, { parse_mode: 'Markdown' });
});

// Markets list
bot.command('markets', (ctx) => {
  const text = `📊 *Active Markets*\n\n` + 
    MARKETS.map(m => 
      `🔹 \`${m.id}\` *${m.title}*\n` +
      `   ${m.category} • Ends ${m.endDate}\n` +
      `   YES: ${(m.yesPrice*100).toFixed(0)}% | NO: ${(m.noPrice*100).toFixed(0)}% • Vol: ${formatVol(m.volume)}`
    ).join('\n\n') +
    `\n\n📖 *Example:* /odds 1`;
  ctx.reply(text, { parse_mode: 'Markdown' });
});

// Odds for specific market
bot.command('odds', (ctx) => {
  const args = ctx.message.text.split(' ')[1];
  const m = MARKETS.find(x => x.id === args);
  if (!m) {
    return ctx.reply('❌ Market not found. Use /markets to see all markets.');
  }
  const text = `📈 *${m.title}*\n\n` +
    `YES: ${(m.yesPrice*100).toFixed(1)}% @ ${formatVol(m.volume)} volume\n` +
    `NO:  ${(m.noPrice*100).toFixed(1)}% @ ${formatVol(m.volume)} volume\n\n` +
    `🗓️ Settles: ${m.endDate}\n` +
    `Category: ${m.category}\n\n` +
    `💬 Bet: /buy YES ${m.id} 10 or /buy NO ${m.id} 10`;
  ctx.reply(text, { parse_mode: 'Markdown' });
});

// Place bet
bot.command('buy', (ctx) => {
  const userId = ctx.from.id.toString();
  const args = ctx.message.text.split(' ').slice(1);
  
  if (args.length < 3) {
    return ctx.reply('📖 Usage: /buy YES 1 10 or /buy NO 2 50\n(Bet 10 units on market 1 YES or 50 on market 2 NO)');
  }
  
  const [side, marketId, amount] = args;
  if (!['YES','NO'].includes(side)) {
    return ctx.reply('❌ Side must be YES or NO');
  }
  const m = MARKETS.find(x => x.id === marketId);
  if (!m) {
    return ctx.reply('❌ Market not found.');
  }
  
  const posId = Date.now().toString();
  const pos = { id: posId, marketId, side, amount: parseFloat(amount), price: side === 'YES' ? m.yesPrice : m.noPrice };
  positions[userId] = positions[userId] || [];
  positions[userId].push(pos);
  
  const payout = (parseFloat(amount) / (side === 'YES' ? m.yesPrice : m.noPrice)).toFixed(4);
  ctx.reply(`✅ *Bet placed!*

${side} on "${m.title}"
Amount: ${amount} units
Potential payout: ${payout} units

Track with /portfolio`, { parse_mode: 'Markdown' });
});

// Portfolio
bot.command('portfolio', (ctx) => {
  const userId = ctx.from.id.toString();
  const userPositions = positions[userId] || [];
  
  if (userPositions.length === 0) {
    return ctx.reply('📭 No positions yet. Use /markets to find markets and /buy to bet.');
  }
  
  const text = `💼 *Your Portfolio*\n\n` +
    userPositions.map(p => {
      const m = MARKETS.find(x => x.id === p.marketId);
      return `🔹 ${p.side} ${p.amount} on "${m?.title || 'Unknown'}" @ ${(p.price*100).toFixed(0)}%`;
    }).join('\n\n');
  
  ctx.reply(text, { parse_mode: 'Markdown' });
});

// Help
bot.command('help', (ctx) => {
  ctx.reply(`📖 *Commands*

/start - Welcome
/markets - List all markets
/odds [id] - Get market odds
/buy YES [id] [amount] - Place YES bet
/buy NO [id] [amount] - Place NO bet
/portfolio - Your positions
/help - This menu`, { parse_mode: 'Markdown' });
});

// Echo all other messages
bot.on('text', (ctx) => {
  ctx.reply('👋 Use /help to see commands. Or /markets to see active markets.');
});

bot.launch().then(() => {
  console.log('✅ Newpot bot running on Telegram');
}).catch(err => {
  console.error('Bot error:', err.message);
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
