const express = require('express');const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware pour parser le JSON
app.use(express.json());

// Cache pour stocker les données des tickers
let tickersCache = [];
let lastFetchTime = 0;
const CACHE_DURATION = 30000; // 30 secondes

// Stockage des alertes de hausses importantes
let spikeAlerts = [];
const SPIKE_THRESHOLD = 0.04; // 4% de hausse

// Clé API Bitget (à sécuriser en production)
const BITGET_API_KEY = 'bg_d361a55fbc6ed7519dd00b39ba9af08e';

// Fonction pour détecter les hausses importantes
function detectSpikes(tickerData) {
  if (!tickerData || !Array.isArray(tickerData)) {
    console.log('⚠️ Aucune donnée de ticker pour la détection de hausses');
    return;
  }
  
  console.log(`🔍 Analyse de ${tickerData.length} tickers pour détecter les hausses...`);
  
  tickerData.forEach((ticker, index) => {
    // Utiliser la variation 24h comme indicateur de hausse importante
    // ou calculer la variation basée sur high24h et low24h
    let spikeValue = 0;
    
    if (ticker.change24h) {
      spikeValue = parseFloat(ticker.change24h);
    } else if (ticker.high24h && ticker.low24h) {
      // Calculer la variation basée sur high/low 24h
      const high = parseFloat(ticker.high24h);
      const low = parseFloat(ticker.low24h);
      const current = parseFloat(ticker.close || ticker.last || 0);
      
      if (low > 0) {
        spikeValue = (current - low) / low;
      }
    }
    
    // Log pour les premières cryptos pour debug
    if (index < 5) {
      const symbol = ticker.symbol ? ticker.symbol.replace('USDT_SPBL', '').replace('_SPBL', '') : 'Unknown';
      console.log(`📈 ${symbol}: variation=${(spikeValue * 100).toFixed(2)}%, seuil=${(SPIKE_THRESHOLD * 100).toFixed(2)}%`);
    }
    
    // Vérifier si la hausse est significative (4% ou plus)
    if (spikeValue >= SPIKE_THRESHOLD) {
      const symbol = ticker.symbol ? ticker.symbol.replace('USDT_SPBL', '').replace('_SPBL', '') : 'Unknown';
      
      // Vérifier si cette alerte n'existe pas déjà (éviter les doublons)
      const existingAlert = spikeAlerts.find(alert => 
        alert.symbol === symbol && 
        Math.abs(alert.spikeValue - spikeValue) < 0.001 &&
        (Date.now() - alert.timestamp) < 300000 // 5 minutes
      );
      
      if (!existingAlert) {
        const alert = {
          symbol: symbol,
          spikeValue: spikeValue,
          spikePercent: (spikeValue * 100).toFixed(2),
          timestamp: Date.now(),
          date: new Date().toLocaleString('fr-FR'),
          price: ticker.close || ticker.last || 0
        };
        
        spikeAlerts.unshift(alert); // Ajouter au début de la liste
        
        // Garder seulement les 50 dernières alertes
        if (spikeAlerts.length > 50) {
          spikeAlerts = spikeAlerts.slice(0, 50);
        }
        
        console.log(`🚀 Hausse détectée: ${symbol} +${alert.spikePercent}%`);
      }
    }
  });
  
  console.log(`✅ Analyse terminée. ${spikeAlerts.length} alertes au total`);
}

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
      
      // Détecter les hausses importantes
      detectSpikes(tickersCache);
      
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

// Endpoint pour récupérer les alertes de hausses importantes
app.get('/api/spike-alerts', (req, res) => {
  try {
    console.log('📊 Récupération des alertes de hausses:', spikeAlerts.length, 'alertes');
    // Retourner les alertes triées par timestamp (plus récentes en premier)
    const sortedAlerts = spikeAlerts.sort((a, b) => b.timestamp - a.timestamp);
    res.json(sortedAlerts);
  } catch (err) {
    console.error('Error fetching spike alerts:', err);
    res.status(500).json({ error: 'Failed to fetch spike alerts' });
  }
});

// Endpoint de test pour vérifier le fonctionnement
app.get('/api/test-spikes', (req, res) => {
  try {
    // Ajouter une alerte de test
    const testAlert = {
      symbol: 'TEST',
      spikeValue: 0.05,
      spikePercent: '5.00',
      timestamp: Date.now(),
      date: new Date().toLocaleString('fr-FR'),
      price: 100.50
    };
    
    spikeAlerts.unshift(testAlert);
    
    res.json({
      message: 'Alerte de test ajoutée',
      totalAlerts: spikeAlerts.length,
      alerts: spikeAlerts.slice(0, 5)
    });
  } catch (err) {
    console.error('Error in test endpoint:', err);
    res.status(500).json({ error: 'Test failed' });
  }
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});


