/**
 * Newpot Stellar Watcher
 * Watches Kk's XLM address for incoming USDC payments
 * Credits user balances automatically when deposits detected
 */

require('dotenv/config');
const axios = require('axios');

const API_URL = process.env.API_URL || 'http://localhost:5000/api';
const STELLAR_ADDRESS = process.env.STELLAR_ADDRESS || 'GB7B3CQJD5L7OX5KGMV6HMZ5Z7EB4CRPITQDG4MK4FZTQW34CU2GZQGZ';
const BOT_TOKEN = process.env.BOT_TOKEN;

// USDC on Stellar - Circle's issuer
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZCH';

// Horizon API endpoints
const HORIZON_PUBLIC = 'https://horizon.stellar.org';

// Track processed transactions to avoid duplicates
const processedTxs = new Set();
let lastCursor = 'now';
let isRunning = false;

// ============================================
// API HELPERS
// ============================================

async function creditUser(userId, amount, txHash) {
  try {
    const res = await axios.post(
      `${API_URL}/wallet/deposit`,
      {
        paymentMethod: 'USDC',
        amount,
        currency: 'USDC',
        txHash
      },
      { headers: { 'x-user-id': userId } }
    );
    return res.data;
  } catch (err) {
    console.error(`Failed to credit user ${userId}:`, err.message);
    return null;
  }
}

async function notifyTelegram(chatId, message) {
  if (!BOT_TOKEN || !chatId) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown'
    });
  } catch {}
}

// ============================================
// STELLAR API
// ============================================

/**
 * Get payments to Kk's address
 * Returns payments newer than cursor
 */
async function getPayments(cursor = 'now') {
  try {
    const url = `${HORIZON_PUBLIC}/accounts/${STELLAR_ADDRESS}/payments`;
    const res = await axios.get(url, {
      params: {
        cursor,
        limit: 50,
        order: 'desc'
      },
      headers: { 'User-Agent': 'Newpot-Watcher/1.0' },
      timeout: 10000
    });
    return res.data;
  } catch (err) {
    console.error('Horizon error:', err.message);
    return null;
  }
}

/**
 * Check if a payment is USDC
 */
function isUSDCPayment(payment) {
  // Must be a payment to our address
  if (payment.to !== STELLAR_ADDRESS) return false;
  
  // Check asset type
  if (payment.asset_type === 'native') return false; // XLM, not USDC
  if (payment.asset_code !== 'USDC') return false;
  if (payment.asset_issuer !== USDC_ISSUER) return false;
  
  return true;
}

/**
 * Extract memo from transaction to identify user
 * Stellar txs can have a memo (up to 28 chars)
 * Users should set memo = their Telegram user ID
 */
function extractMemo(tx) {
  return tx.memo || null;
}

/**
 * Format amount (USDC has 7 decimals on Stellar)
 */
function formatAmount(amount) {
  return (parseFloat(amount) / 10000000).toFixed(2);
}

// ============================================
// MAIN WATCHER LOOP
// ============================================

async function checkDeposits() {
  if (isRunning) return; // Prevent overlapping checks
  isRunning = true;

  try {
    const data = await getPayments(lastCursor);
    
    if (!data || !data._embedded || !data._embedded.records) {
      isRunning = false;
      return;
    }

    const records = data._embedded.records;
    
    // Update cursor for next poll
    if (records.length > 0) {
      lastCursor = records[0].paging_token;
    }

    // Process records (newest first due to desc order)
    // We process in chronological order (reverse)
    for (let i = records.length - 1; i >= 0; i--) {
      const record = records[i];
      
      // Skip if not a payment
      if (record.type !== 'payment') continue;
      
      // Skip if already processed
      if (processedTxs.has(record.id)) continue;
      
      // Check if USDC
      if (!isUSDCPayment(record)) continue;
      
      const amount = formatAmount(record.amount);
      const memo = extractMemo(record);
      const txHash = record.transaction_hash;
      
      console.log(`💰 USDC Deposit detected!`);
      console.log(`   Amount: $${amount} USDC`);
      console.log(`   From: ${record.from}`);
      console.log(`   Memo: ${memo || 'none (user may not be identified)'}`);
      console.log(`   TxHash: ${txHash}`);
      
      // Mark as processed BEFORE crediting
      processedTxs.add(record.id);
      
      // Keep processedTxs from growing indefinitely
      if (processedTxs.size > 1000) {
        const arr = Array.from(processedTxs);
        processedTxs.clear();
        arr.slice(-500).forEach(tx => processedTxs.add(tx));
      }
      
      // If memo is provided (user's Telegram ID), credit them
      if (memo) {
        const userId = memo;
        console.log(`   Crediting user ${userId}...`);
        
        const result = await creditUser(userId, amount, txHash);
        
        if (result?.success) {
          console.log(`   ✅ Credited $${amount} to user ${userId}`);
          await notifyTelegram(
            process.env.OWNER_CHAT_ID,
            `💰 *New USDC Deposit!*\n$${amount} USDC\nFrom: \`${record.from.substring(0, 10)}...\`\nUser: ${userId}\nTx: \`${txHash.substring(0, 15)}...\``
          );
        } else {
          console.log(`   ❌ Failed to credit user ${userId}`);
          await notifyTelegram(
            process.env.OWNER_CHAT_ID,
            `⚠️ *Deposit detected but NOT credited*\n$${amount} USDC\nFrom: ${record.from}\nUser ID: ${userId}\nError: ${result?.error?.message || 'Unknown'}`
          );
        }
      } else {
        // No memo - deposit to Kk's wallet, manual assignment needed
        console.log(`   ⚠️ No memo - deposit to Kk's wallet`);
        await notifyTelegram(
          process.env.OWNER_CHAT_ID,
          `💰 *USDC Deposit (no memo)*\n$${amount} USDC\nFrom: \`${record.from}\`\nTx: \`${txHash}\`\n\n_User must contact support to claim_`
        );
      }
    }

  } catch (err) {
    console.error('Check error:', err.message);
  } finally {
    isRunning = false;
  }
}

// ============================================
// WATCHER CONTROL
// ============================================

let watchInterval = null;

function start() {
  console.log('🚀 Starting Stellar USDC Watcher...');
  console.log(`📬 Watching: ${STELLAR_ADDRESS}`);
  console.log(`🔗 Horizon: ${HORIZON_PUBLIC}`);
  console.log('');
  
  // Initial check
  checkDeposits();
  
  // Poll every 15 seconds
  watchInterval = setInterval(checkDeposits, 15000);
  
  console.log('👀 Watching for USDC deposits...');
}

function stop() {
  if (watchInterval) {
    clearInterval(watchInterval);
    watchInterval = null;
  }
  console.log('⏹️ Watcher stopped');
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stop();
  process.exit(0);
});

// ============================================
// HEALTH CHECK
// ============================================

async function healthCheck() {
  try {
    const res = await axios.get(`${HORIZON_PUBLIC}/accounts/${STELLAR_ADDRESS}`, {
      timeout: 5000
    });
    return res.data.balances || [];
  } catch (err) {
    console.error('Health check failed:', err.message);
    return [];
  }
}

// ============================================
// CLI
// ============================================

if (require.main === module) {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║   NEWPOT USDC WATCHER (Stellar)      ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');
  
  start();
  
  // Status report every 5 minutes
  setInterval(async () => {
    const balances = await healthCheck();
    console.log(`[${new Date().toISOString()}] Status: OK | Tx tracked: ${processedTxs.size}`);
    if (balances.length > 0) {
      const usdc = balances.find(b => b.asset_code === 'USDC');
      if (usdc) console.log(`   USDC balance: ${usdc.balance}`);
    }
  }, 300000);
}

module.exports = { start, stop, checkDeposits, healthCheck };
