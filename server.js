const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware pour parser le JSON
app.use(express.json());

// Cache pour stocker les données des tickers
let tickersCache = [];
let lastFetchTime = 0;
const CACHE_DURATION = 30000; // 30 secondes

// Clé API Bitget (à sécuriser en production)
const BITGET_API_KEY = 'bg_d361a55fbc6ed7519dd00b39ba9af08e';

// Autoriser CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

// Endpoint pour récupérer tous les tickers
app.get('/api/bitget/all-tickers', async (req, res) => {
  const now = Date.now();
  
  // Utiliser le cache si les données sont récentes
  if (tickersCache.length > 0 && (now - lastFetchTime) < CACHE_DURATION) {
    console.log('Returning cached tickers data');
    return res.json(tickersCache);
  }

  const url = 'https://api.bitget.com/api/spot/v1/market/tickers?productType=USDT-FUTURES';
  console.log('Fetching all tickers from Bitget API');

  try {
    console.log(`Making request to: ${url}`);
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': BITGET_API_KEY
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API Error: ${response.status} - ${errorText}`);
      throw new Error(`API request failed with status ${response.status}`);
    }
    
    const data = await response.json();
    console.log('API Response:', JSON.stringify(data, null, 2).substring(0, 500) + '...');

    if (data.code === '00000' || (Array.isArray(data) && data.length > 0)) {
      // Mettre à jour le cache
      tickersCache = data.data || [];
      lastFetchTime = now;
      console.log(`Fetched ${tickersCache.length} tickers from Bitget API`);
      return res.json(tickersCache);
    } else {
      console.error('Error from Bitget API:', data);
      return res.status(response.status || 500).json({ 
        error: data.msg || 'Failed to fetch tickers',
        code: data.code
      });
    }
  } catch (err) {
    console.error('Error fetching tickers:', err);
    return res.status(500).json({ 
      error: 'Failed to fetch tickers',
      details: err.message 
    });
  }
});

// Endpoint pour un ticker spécifique (maintenant utilise le cache)
app.get('/api/bitget/ticker', async (req, res) => {
  const raw = req.query.symbol || 'BTCUSDT_SPBL';
  const symbol = raw.toUpperCase().trim();
  
  try {
    // D'abord essayer de récupérer depuis le cache
    const cachedTicker = tickersCache.find(t => t.symbol === symbol);
    if (cachedTicker) {
      return res.json(cachedTicker);
    }
    
    // Sinon, faire une requête directe
    const url = `https://api.bitget.com/api/spot/v1/market/ticker?symbol=${symbol}`;
    console.log('Fetching single ticker:', url);
    
    const response = await fetch(url);
    const data = await response.json();

    if (response.ok && data.code === '00000') {
      // Mettre à jour le cache
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

// Endpoint pour les bougies et variation %
app.get('/api/bitget/candles', async (req, res) => {
  const raw = req.query.symbol || 'BTCUSDT_SPBL';
  const period = req.query.period || '1h'; // '5min' ou '1h'
  const symbol = raw.toUpperCase().trim();
  const url = `https://api.bitget.com/api/spot/v1/market/candles?symbol=${symbol}&period=${period}&limit=1`;

  console.log(`Requesting candles: ${url}`);

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (response.ok && data.code === '00000' && data.data && data.data.length > 0) {
      const candle = data.data[0];
      const open = parseFloat(candle.open);
      const close = parseFloat(candle.close);

      const variation = ((close - open) / open) * 100; // en pourcentage

      return res.json({
        symbol,
        period,
        open,
        close,
        variation: variation.toFixed(8), // ex: -0.0315
        ts: candle.ts,
      });
    } else {
      return res.status(response.status).json({ error: data });
    }

  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
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
