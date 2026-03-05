const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const multer = require('multer');
const cron = require('node-cron');

// Load environment variables
dotenv.config();

// Import routes
const authRoutes = require('./routes/auth');
const companyRoutes = require('./routes/companies');
const reportRoutes = require('./routes/reports');
const newsRoutes = require('./routes/news');

// Import services
const { runNewsUpdateForAll } = require('./services/newsService');

// Initialize Express app
const app = express();

// Middleware
app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:3002'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
    .then(() => console.log('✅ MongoDB connected successfully'))
    .catch(err => {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    });

// Routes
app.get('/', (req, res) => {
    res.json({
        message: 'ESG Analytics Platform API',
        version: '1.0.0',
        endpoints: {
            auth: '/api/auth',
            companies: '/api/companies',
            reports: '/api/reports'
        }
    });
});

app.use('/api/auth', authRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/news', newsRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);

    if (err instanceof multer.MulterError) {
        return res.status(400).json({
            success: false,
            message: err.message
        });
    }

    res.status(500).json({
        success: false,
        message: err.message || 'Internal server error'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🐍 Python Service URL: ${process.env.PYTHON_SERVICE_URL || 'http://localhost:8000'}`);

    // Schedule daily news analysis at 2:00 AM
    cron.schedule('0 2 * * *', async () => {
        console.log('🕐 [CRON] Running scheduled daily news update...');
        try {
            await runNewsUpdateForAll();
        } catch (err) {
            console.error('[CRON] News update failed:', err.message);
        }
    }, {
        timezone: 'Asia/Kolkata'
    });
    console.log('📰 News cron job scheduled: daily at 2:00 AM IST');
});

module.exports = app;
