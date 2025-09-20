const express = require('express'); 
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const app = express();
const PORT = process.env.PORT || 3000;

// Autoriser CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

// Endpoint pour le ticker actuel
app.get('/api/bitget/ticker', async (req, res) => {
  const raw = req.query.symbol || 'BTCUSDT_SPBL';
  const symbol = raw.toUpperCase().trim();
  const url = `https://api.bitget.com/api/spot/v1/market/ticker?symbol=${symbol}`;

  console.log('Requesting:', url);

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
        variation: variation.toFixed(4), // ex: -0.0315
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
