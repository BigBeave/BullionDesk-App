const express = require('express');
const path = require('path');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 10000;

// 1. Middleware Config
app.use(cors()); // Allow open access for standalone installs
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 mins
  max: 200,                 // Limit 200 requests
  message: { error: "Rate limited. Please try again in a few minutes." }
});
app.use('/metals', limiter);

// 2. API Endpoint: Yahoo Finance Commodity Proxy
function fetchYahooFutures(symbol) {
  return new Promise((resolve, reject) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;
    const req = https.get(url, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
          const json = JSON.parse(data);
          if (!json.chart || !json.chart.result || !json.chart.result[0]) {
            throw new Error('Malformed Yahoo response');
          }
          const meta = json.chart.result[0].meta;
          resolve({
            price: meta.regularMarketPrice,
            prevClose: meta.chartPreviousClose,
            change: meta.regularMarketPrice - meta.chartPreviousClose
          });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

app.get('/metals', async (req, res) => {
  try {
    console.log(`[${new Date().toISOString()}] Incoming metals request...`);
    const [gold, silver] = await Promise.all([
      fetchYahooFutures("GC=F").catch(e => { console.error("Gold fetch err:", e.message); return null; }),
      fetchYahooFutures("SI=F").catch(e => { console.error("Silver fetch err:", e.message); return null; })
    ]);

    if (!gold || !silver) {
      return res.status(502).json({ error: "Backend unable to fetch prices from provider." });
    }

    res.json({
      timestamp: Date.now(),
      data: {
        gold: {
          price: gold.price,
          change: gold.change,
          changePercent: (gold.change / gold.prevClose) * 100
        },
        silver: {
          price: silver.price,
          change: silver.change,
          changePercent: (silver.change / silver.prevClose) * 100
        }
      }
    });
  } catch (err) {
    res.status(500).json({ error: "Internal Gateway Error", message: err.message });
  }
});

// 3. Static Assets & Frontend Router
// Serves all static frontend files out of the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Health Check
app.get('/health', (req, res) => res.send('BullionDesk Gateway Healthy'));

// Fallback all other routes to index.html (standard PWA behavior)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 4. Start Server
app.listen(PORT, () => {
  console.log(`==============================================`);
  console.log(`🚀 BULLION DESK SERVER IS ONLINE`);
  console.log(`📡 Listening on Port: ${PORT}`);
  console.log(`📦 Serving static directory: /public`);
  console.log(`==============================================`);
});
