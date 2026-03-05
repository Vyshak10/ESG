const express = require('express');
const router = express.Router();
const Company = require('../models/Company');
const NewsImpact = require('../models/NewsImpact');
const { auth, requireAdmin } = require('../middleware/auth');
const { processNewsForCompany, runNewsUpdateForAll } = require('../services/newsService');

// @route   GET /api/news/:companyId
// @desc    Get latest news impact analysis for a company
// @access  Private
router.get('/:companyId', auth, async (req, res) => {
    try {
        const newsImpact = await NewsImpact.findOne({ company: req.params.companyId });

        if (!newsImpact) {
            return res.json({
                success: true,
                message: 'No news analysis available yet. Analysis runs daily at 2:00 AM.',
                newsImpact: null
            });
        }

        res.json({
            success: true,
            newsImpact
        });

    } catch (error) {
        console.error('Get news impact error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/news/refresh/:companyId
// @desc    Manually trigger news refresh for a specific company (Admin only)
// @access  Private (Admin)
router.post('/refresh/:companyId', [auth, requireAdmin], async (req, res) => {
    try {
        const company = await Company.findById(req.params.companyId).select('name latestScores');
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }

        // Trigger immediately (don't await — return fast)
        res.json({
            success: true,
            message: `News analysis started for "${company.name}". Check back in a moment.`
        });

        // Run in background
        processNewsForCompany(company).catch(err => {
            console.error(`[News Route] Manual refresh failed for ${company.name}:`, err.message);
        });

    } catch (error) {
        console.error('News refresh error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/news/refresh-all
// @desc    Manually trigger news refresh for ALL companies (Admin only)
// @access  Private (Admin)
router.post('/refresh-all', [auth, requireAdmin], async (req, res) => {
    try {
        res.json({
            success: true,
            message: 'News analysis started for all companies. Results will be available shortly.'
        });

        runNewsUpdateForAll().catch(err => {
            console.error('[News Route] refresh-all failed:', err.message);
        });

    } catch (error) {
        console.error('News refresh-all error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
