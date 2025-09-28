
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Cache pour stocker les données des tickers + variations 5m
let tickersCache = [];
let variationsCache = {}; // { symbol: {open, close, variation, ts} }
let lastFetchTime = 0;
const CACHE_DURATION = 30000; // 30 secondes

const BITGET_API_KEY = 'bg_d361a55fbc6ed7519dd00b39ba9af08e';

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

// Endpoint pour récupérer tous les tickers avec variation 5m
app.get('/api/bitget/all-tickers', async (req, res) => {
  const now = Date.now();

  if (tickersCache.length > 0 && (now - lastFetchTime) < CACHE_DURATION) {
    // Retourner le cache avec les variations 5m intégrées
    const tickersWithVariation = tickersCache.map(ticker => {
      const variationData = variationsCache[ticker.symbol] || {};
      return {
        ...ticker,
        change5m: variationData.variation !== undefined ? variationData.variation / 100 : 0,
        open5m: variationData.open,
        close5m: variationData.close,
        ts5m: variationData.ts
      };
    });
    return res.json(tickersWithVariation);
  }

  const url = 'https://api.bitget.com/api/spot/v1/market/tickers?productType=USDT-FUTURES';

  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': BITGET_API_KEY
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed with status ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    if (data.code === '00000') {
      tickersCache = data.data || [];
      lastFetchTime = now;

      // Mettre à jour aussi les variations 5m pour chaque symbole
      await Promise.all(tickersCache.map(async ticker => {
        const symbol = ticker.symbol;
        try {
          const candleUrl = `https://api.bitget.com/api/spot/v1/market/candles?symbol=${symbol}&period=5min&limit=1`;
          const candleResponse = await fetch(candleUrl);
          const candleData = await candleResponse.json();
          if (candleResponse.ok && candleData.code === '00000' && candleData.data.length > 0) {
            const candle = candleData.data[0];
            const open = parseFloat(candle.open);
            const close = parseFloat(candle.close);
            const variation = ((close - open) / open) * 100;
            variationsCache[symbol] = {
              open,
              close,
              variation,
              ts: candle.ts
            };
          }
        } catch (e) {
          console.error('Erreur candle 5m pour', symbol, e);
        }
      }));

      // Fusionner tickers + variations
      const tickersWithVariation = tickersCache.map(ticker => {
        const variationData = variationsCache[ticker.symbol] || {};
        return {
          ...ticker,
          change5m: variationData.variation !== undefined ? variationData.variation / 100 : 0,
          open5m: variationData.open,
          close5m: variationData.close,
          ts5m: variationData.ts
        };
      });

      return res.json(tickersWithVariation);
    } else {
      return res.status(response.status).json({ error: data });
    }
  } catch (err) {
    console.error('Error fetching all tickers:', err);
    return res.status(500).json({ error: 'Failed to fetch tickers', details: err.message });
  }
});

// Les endpoints existants
app.get('/api/bitget/all-tickers', async (req, res) => {
  const raw = req.query.symbol || 'BTCUSDT_SPBL';
  const symbol = raw.toUpperCase().trim();
  try {
    const cachedTicker = tickersCache.find(t => t.symbol === symbol);
    if (cachedTicker) {
      return res.json(cachedTicker);
    }
    const url = `https://api.bitget.com/api/spot/v1/market/ticker?symbol=${symbol}`;
    const response = await fetch(url);
    const data = await response.json();
    if (response.ok && data.code === '00000') {
      tickersCache = tickersCache.filter(t => t.symbol !== symbol);
      tickersCache.push(data.data);
      return res.json(data.data);
    } else {
      return res.status(response.status).json({ error: data });
    }
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: String(err) });
  }
});

app.get('/api/bitget/candles', async (req, res) => {
  const raw = req.query.symbol || 'BTCUSDT_SPBL';
  const period = req.query.period || '1h';
  const symbol = raw.toUpperCase().trim();
  const url = `https://api.bitget.com/api/spot/v1/market/candles?symbol=${symbol}&period=${period}&limit=1`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (response.ok && data.code === '00000' && data.data.length > 0) {
      const candle = data.data[0];
      const open = parseFloat(candle.open);
      const close = parseFloat(candle.close);
      const variation = ((close - open) / open) * 100;
      return res.json({
        symbol,
        period,
        open,
        close,
        variation: variation.toFixed(8),
        ts: candle.ts
      });
    } else {
      return res.status(response.status).json({ error: data });
    }
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: String(err) });
  }
});

app.get('/api/bitget/products', async (req, res) => {
  const url = 'https://api.bitget.com/api/spot/v1/public/products';
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (response.ok && data.code === '00000') {
      return res.json(data.data);
    } else {
      return res.status(response.status).json({ error: data });
    }
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: String(err) });
  }
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
