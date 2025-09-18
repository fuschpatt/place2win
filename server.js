require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BITGET_API_KEY = process.env.BITGET_API_KEY || '';

/**
 * Simple in-memory cache to reduce calls.
 * key => { data, ts }
 */
const cache = {};
const CACHE_TTL_MS = 5 * 1000; // 5s (ajuste si besoin)

/** Helper: get cached or fetch */
async function cachedFetch(key, fetcher, ttl = CACHE_TTL_MS) {
  const now = Date.now();
  if (cache[key] && (now - cache[key].ts) < ttl) return cache[key].data;
  const data = await fetcher();
  cache[key] = { data, ts: now };
  return data;
}

/** Proxy: Bitget tickers (public) */
app.get('/api/bitget/tickers', async (req, res) => {
  try {
    const data = await cachedFetch('bitget:tickers', async () => {
      const headers = {};
      if (BITGET_API_KEY) headers['x-api-key'] = BITGET_API_KEY;
      const r = await axios.get('https://api.bitget.com/api/v2/spot/market/tickers', { headers, timeout: 8000 });
      return r.data;
    }, 2000);
    res.json(data);
  } catch (e) {
    console.error('tickers error', e?.message || e);
    res.status(500).json({ error: 'Bitget tickers error' });
  }
});

/** Proxy: Bitget klines */
app.get('/api/bitget/klines', async (req, res) => {
  try {
    const { symbol, interval } = req.query;
    if (!symbol || !interval) return res.status(400).json({ error: 'symbol & interval required' });

    const cacheKey = `bitget:klines:${symbol}:${interval}`;
    const data = await cachedFetch(cacheKey, async () => {
      const url = `https://api.bitget.com/api/v3/market/candles?category=SPOT&symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=2`;
      const headers = {};
      if (BITGET_API_KEY) headers['x-api-key'] = BITGET_API_KEY;
      const r = await axios.get(url, { headers, timeout: 8000 });
      return r.data;
    }, 2000);

    res.json(data);
  } catch (e) {
    console.error('klines error', e?.message || e);
    res.status(500).json({ error: 'Bitget klines error' });
  }
});

/** Proxy: CoinGecko markets (page param) */
app.get('/api/coingecko/markets', async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const key = `cg:markets:p${page}`;
    const data = await cachedFetch(key, async () => {
      const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&page=${page}`;
      const r = await axios.get(url, { timeout: 10000 });
      return r.data;
    }, 60 * 1000); // 1 min
    res.json(data);
  } catch (e) {
    console.error('coingecko error', e?.message || e);
    res.status(500).json({ error: 'CoinGecko error' });
  }
});

/** (Optionnel) Servir le front depuis ./public */
app.use(express.static('public'));

app.listen(PORT, () => console.log(`Bitget proxy listening on http://localhost:${PORT}`));
