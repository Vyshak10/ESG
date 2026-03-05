const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, default: '' },
    url: { type: String, default: '' },
    source: { type: String, default: '' },
    publishedAt: { type: Date, default: Date.now },

    // AI Analysis results
    esgCategory: {
        type: String,
        enum: ['Environmental', 'Social', 'Governance', 'None'],
        default: 'None'
    },
    sentiment: {
        type: String,
        enum: ['Positive', 'Negative', 'Neutral'],
        default: 'Neutral'
    },
    sentimentConfidence: { type: Number, default: 0.5 },

    // Score contribution from this article (±, e.g. +2.3 or -1.8)
    scoreImpact: { type: Number, default: 0 },

    // Human-readable reason why score changed
    reason: { type: String, default: '' }
});

const newsImpactSchema = new mongoose.Schema({
    company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    fetchedAt: { type: Date, default: Date.now },

    // The articles found and analysed
    articles: [articleSchema],

    // Net score delta per category (can be negative or positive)
    scoreAdjustments: {
        environmental: { type: Number, default: 0 },
        social:         { type: Number, default: 0 },
        governance:     { type: Number, default: 0 },
        overall:        { type: Number, default: 0 }
    },

    // Original scores at time of fetch (for context)
    originalScores: {
        environmental: { type: Number, default: 0 },
        social:         { type: Number, default: 0 },
        governance:     { type: Number, default: 0 },
        overall:        { type: Number, default: 0 }
    },

    // Final adjusted scores (original + adjustment, clamped 0–100)
    newsAdjustedScores: {
        environmental: { type: Number, default: 0 },
        social:         { type: Number, default: 0 },
        governance:     { type: Number, default: 0 },
        overall:        { type: Number, default: 0 }
    },

    // Number of articles that were processed
    articlesProcessed: { type: Number, default: 0 },

    // Did the fetch succeed?
    status: {
        type: String,
        enum: ['success', 'failed', 'no_articles'],
        default: 'success'
    },
    errorMessage: { type: String, default: '' }
});

// Keep one record per company (upsert on each cron run)
newsImpactSchema.index({ company: 1 }, { unique: true });

module.exports = mongoose.model('NewsImpact', newsImpactSchema);
