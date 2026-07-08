// P2P Exchange — Unified Server (Render-compatible)
// Serves: static frontend + API via Express

const express = require('express');
const path = require('path');
const apiHandler = require('./api/index');

const app = express();
const PORT = process.env.PORT || 3000;

// Raw body parsing for API (Express-compatible)
app.use('/api', express.json({ type: ['application/json', 'text/plain'] }));
app.use('/api', express.text({ type: 'text/plain' }));

// API middleware — proxy all requests to the Vercel-style handler
app.all('/api/*', async (req, res) => {
    req.query = req.query || {};
    await apiHandler(req, res);
});
app.all('/api', async (req, res) => {
    req.query = req.query || {};
    await apiHandler(req, res);
});

// Static frontend
app.use(express.static(__dirname));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`P2P Exchange v3 running on port ${PORT}`);
    console.log(`Health: http://localhost:${PORT}/api/health`);
});
