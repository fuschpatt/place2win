const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const compression = require('compression');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware pour parser le JSON
app.use(express.json());

// Middleware de compression pour accélérer les réponses
app.use(compression());

// Cache pour stocker les données des tickers
let tickersCache = [];
let lastFetchTime = 0;
const CACHE_DURATION = 15000; // Réduit à 15 secondes pour plus de fraîcheur

// Cache pour les bougies (candles)
let candlesCache = new Map();
const CANDLES_CACHE_DURATION = 60000; // 1 minute pour les bougies

// Cache pour les requêtes en cours (évite les requêtes multiples simultanées)
let pendingRequests = new Map();

// Autoriser CORS avec headers optimisés
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Cache-Control', 'public, max-age=10'); // Cache côté client
  next();
});

// Fonction pour formater les données des tickers (ne garder que les infos essentielles)
function formatTickerData(rawTicker) {
  return {
    symbol: rawTicker.symbol,
    price: parseFloat(rawTicker.close),
    change24h: parseFloat(rawTicker.change) * 100, // Convertir en pourcentage
    high24h: parseFloat(rawTicker.high24h),
    low24h: parseFloat(rawTicker.low24h),
    volume24h: parseFloat(rawTicker.quoteVol),
    timestamp: rawTicker.ts
  };
}

// Fonction pour éviter les requêtes multiples simultanées
async function fetchWithDeduplication(key, fetchFunction) {
  if (pendingRequests.has(key)) {
    console.log(`Waiting for pending request: ${key}`);
    return await pendingRequests.get(key);
  }

  const promise = fetchFunction();
  pendingRequests.set(key, promise);
  
  try {
    const result = await promise;
    return result;
  } finally {
    pendingRequests.delete(key);
  }
}

// Endpoint principal pour récupérer tous les tickers
app.get('/api/bitget/all-tickers', async (req, res) => {
  const now = Date.now();
  
  // Utiliser le cache si les données sont récentes
  if (tickersCache.length > 0 && (now - lastFetchTime) < CACHE_DURATION) {
    console.log('Returning cached tickers data');
    return res.json(tickersCache);
  }

  const url = 'https://api.bitget.com/api/spot/v1/market/tickers?productType=USDT-FUTURES';
  
  try {
    const data = await fetchWithDeduplication('all-tickers', async () => {
      console.log('Fetching all tickers from Bitget API');
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          'Accept-Encoding': 'gzip, deflate, br'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API Error: ${response.status} - ${errorText}`);
        throw new Error(`API request failed with status ${response.status}`);
      }
      
      const data = await response.json();
      console.log('API Response received');

      if (data.code === '00000' && data.data && Array.isArray(data.data)) {
        // Formater les données pour ne garder que l'essentiel
        const formattedData = data.data.map(formatTickerData);
        tickersCache = formattedData;
        lastFetchTime = now;
        console.log(`Fetched and formatted ${tickersCache.length} tickers from Bitget API`);
        return formattedData;
      } else {
        console.error('Error from Bitget API:', data);
        throw new Error(data.msg || 'Failed to fetch tickers');
      }
    });

    return res.json(data);
  } catch (err) {
    console.error('Error fetching tickers:', err);
    return res.status(500).json({ 
      error: 'Failed to fetch tickers',
      details: err.message 
    });
  }
});

// Endpoint pour un ticker spécifique (utilise le cache)
app.get('/api/bitget/ticker', async (req, res) => {
  const symbol = (req.query.symbol || 'BTCUSDT').toUpperCase().trim();
  
  try {
    // D'abord essayer de récupérer depuis le cache
    const cachedTicker = tickersCache.find(t => t.symbol === symbol);
    if (cachedTicker) {
      return res.json(cachedTicker);
    }
    
    // Si pas dans le cache, retourner une erreur
    return res.status(404).json({ 
      error: 'Ticker not found in cache. Please refresh the all-tickers endpoint first.' 
    });
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: String(err) });
  }
});

// Endpoint pour les bougies et variation % (avec cache optimisé)
app.get('/api/bitget/candles', async (req, res) => {
  const raw = req.query.symbol || 'BTCUSDT_SPBL';
  const period = req.query.period || '1h'; // '5min' ou '1h'
  const symbol = raw.toUpperCase().trim();
  const cacheKey = `${symbol}_${period}`;
  const now = Date.now();
  
  // Vérifier le cache des bougies
  const cachedCandle = candlesCache.get(cacheKey);
  if (cachedCandle && (now - cachedCandle.timestamp) < CANDLES_CACHE_DURATION) {
    console.log(`Returning cached candle data for ${cacheKey}`);
    return res.json(cachedCandle.data);
  }
  
  // Utiliser le bon endpoint selon la période
  let url;
  if (period === '5min') {
    url = `https://api.bitget.com/api/spot/v1/market/candles?symbol=${symbol}&period=5m&limit=1`;
  } else {
    url = `https://api.bitget.com/api/spot/v1/market/candles?symbol=${symbol}&period=1h&limit=1`;
  }

  try {
    const data = await fetchWithDeduplication(`candles_${cacheKey}`, async () => {
      console.log(`Requesting candles: ${url}`);
      const response = await fetch(url, {
        headers: {
          'Accept-Encoding': 'gzip, deflate, br'
        }
      });
      const data = await response.json();

      if (response.ok && data.code === '00000' && data.data && data.data.length > 0) {
        const candle = data.data[0];
        const open = parseFloat(candle.open);
        const close = parseFloat(candle.close);
        const variation = ((close - open) / open) * 100; // en pourcentage

        const result = {
          symbol,
          period,
          open,
          close,
          variation: variation.toFixed(8), // ex: -0.0315
          ts: candle.ts,
        };

        // Mettre en cache
        candlesCache.set(cacheKey, {
          data: result,
          timestamp: now
        });

        return result;
      } else {
        throw new Error(data.msg || 'Failed to fetch candles');
      }
    });

    return res.json(data);
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: String(err) });
  }
});

// Fonction de préchargement automatique
async function preloadData() {
  try {
    console.log('Preloading tickers data...');
    const url = 'https://api.bitget.com/api/spot/v1/market/tickers?productType=USDT-FUTURES';
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.code === '00000' && data.data && Array.isArray(data.data)) {
        tickersCache = data.data.map(formatTickerData);
        lastFetchTime = Date.now();
        console.log(`Preloaded ${tickersCache.length} tickers`);
      }
    }
  } catch (err) {
    console.error('Error preloading data:', err);
  }
}

// Précharger les données au démarrage
preloadData();

// Précharger toutes les 30 secondes
setInterval(preloadData, 30000);

// Nettoyer le cache des bougies toutes les 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of candlesCache.entries()) {
    if (now - value.timestamp > CANDLES_CACHE_DURATION) {
      candlesCache.delete(key);
    }
  }
  console.log(`Cleaned candles cache. Current size: ${candlesCache.size}`);
}, 300000);

// Endpoint de santé amélioré
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    cachedTickers: tickersCache.length,
    cachedCandles: candlesCache.size,
    lastUpdate: new Date(lastFetchTime).toISOString(),
    pendingRequests: pendingRequests.size,
    uptime: process.uptime()
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Optimizations enabled:');
  console.log('- Compression: ON');
  console.log('- Request deduplication: ON');
  console.log('- Auto-preloading: ON');
  console.log('- Smart caching: ON');
});

