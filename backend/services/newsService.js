const axios = require('axios');
const Company = require('../models/Company');
const NewsImpact = require('../models/NewsImpact');

// Top 5 authoritative news sources for ESG authenticity
const TOP_SOURCES = 'reuters,bbc-news,bloomberg,the-guardian-uk,associated-press';

const NEWS_API_KEY = process.env.NEWS_API_KEY;
const NEWS_API_BASE = 'https://newsapi.org/v2/everything';
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:8000';

/**
 * Sentiment value mapping for weighted scoring
 */
const SENTIMENT_VALUE = {
    Positive: 1.0,
    Neutral: 0.0,
    Negative: -1.0
};

/**
 * ESG keywords for fallback categorization (if Python service unavailable)
 */
const ESG_KEYWORDS = {
    Environmental: [
        'emission', 'carbon', 'climate', 'pollution', 'renewable', 'energy',
        'environment', 'greenhouse', 'sustainability', 'waste', 'water',
        'biodiversity', 'fossil', 'solar', 'wind', 'recycling', 'deforestation'
    ],
    Social: [
        'worker', 'employee', 'diversity', 'inclusion', 'labor', 'human rights',
        'community', 'safety', 'health', 'gender', 'discrimination', 'wage',
        'supply chain', 'inequality', 'social', 'workforce'
    ],
    Governance: [
        'board', 'executive', 'compliance', 'corruption', 'bribery', 'audit',
        'transparency', 'shareholder', 'ethics', 'regulation', 'director',
        'whistleblower', 'data privacy', 'gdpr', 'governance', 'risk management'
    ]
};

/**
 * Fallback keyword-based ESG categorizer
 */
function keywordCategorize(text) {
    const lower = text.toLowerCase();
    const scores = { Environmental: 0, Social: 0, Governance: 0 };
    for (const [cat, keywords] of Object.entries(ESG_KEYWORDS)) {
        for (const kw of keywords) {
            if (lower.includes(kw)) scores[cat]++;
        }
    }
    const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    return top[1] > 0 ? top[0] : 'None';
}

/**
 * Send text to Python FinBERT for ESG category + sentiment
 */
async function analyzeWithFinBERT(text) {
    try {
        const response = await axios.post(
            `${PYTHON_SERVICE_URL}/analyze-text`,
            { text: text.substring(0, 1000) }, // Limit to avoid token overflow
            { timeout: 15000 }
        );
        return {
            esgCategory: response.data.esg_category,
            sentiment: response.data.sentiment,
            sentimentConfidence: response.data.sentiment_confidence
        };
    } catch (err) {
        // Fallback: use keyword categorizer + neutral sentiment
        const category = keywordCategorize(text);
        return {
            esgCategory: category,
            sentiment: 'Neutral',
            sentimentConfidence: 0.5
        };
    }
}

/**
 * Generate a human-readable reason string for the score impact
 */
function generateReason(article, esgCategory, sentiment, scoreImpact) {
    const direction = scoreImpact > 0 ? 'positively' : scoreImpact < 0 ? 'negatively' : 'neutrally';
    const absImpact = Math.abs(scoreImpact).toFixed(1);
    const sentimentLabel = sentiment.toLowerCase();

    const categoryDescriptions = {
        Environmental: 'environmental practices (emissions, climate, energy)',
        Social: 'social responsibility (workers, community, diversity)',
        Governance: 'corporate governance (compliance, board, ethics)'
    };

    const catDesc = categoryDescriptions[esgCategory] || 'ESG practices';

    return `${sentiment} news from ${article.source} about company's ${catDesc}. ` +
        `This ${sentimentLabel} coverage impacts the ${esgCategory} score ${direction} by ${absImpact} points.`;
}

/**
 * Compute final score adjustments from analysed articles
 * Formula: rawImpact = Σ(sentiment_val × confidence) / n_articles_in_category
 *          scaledDelta = rawImpact × 10  (max ±10 per category)
 */
function computeScoreAdjustments(articles) {
    const buckets = {
        Environmental: { sum: 0, count: 0 },
        Social: { sum: 0, count: 0 },
        Governance: { sum: 0, count: 0 }
    };

    for (const art of articles) {
        if (art.esgCategory === 'None') continue;
        const sentVal = SENTIMENT_VALUE[art.sentiment] || 0;
        buckets[art.esgCategory].sum += sentVal * art.sentimentConfidence;
        buckets[art.esgCategory].count += 1;
    }

    const adjustments = {};
    for (const [cat, { sum, count }] of Object.entries(buckets)) {
        if (count === 0) {
            adjustments[cat.toLowerCase()] = 0;
        } else {
            const raw = sum / count;            // −1.0 to +1.0
            adjustments[cat.toLowerCase()] = parseFloat((raw * 10).toFixed(2)); // max ±10
        }
    }

    // Overall = average of three category adjustments
    const allDeltas = Object.values(adjustments);
    adjustments.overall = parseFloat(
        (allDeltas.reduce((a, b) => a + b, 0) / allDeltas.length).toFixed(2)
    );

    return adjustments;
}

/**
 * Clamp a score to [0, 100]
 */
function clamp(value) {
    return Math.min(100, Math.max(0, parseFloat(value.toFixed(1))));
}

/**
 * Main function: fetch & analyse news for a single company
 */
async function processNewsForCompany(company) {
    console.log(`📰 [NewsService] Processing news for: ${company.name}`);

    if (!NEWS_API_KEY) {
        throw new Error('NEWS_API_KEY is not set in environment variables');
    }

    // 1. Fetch articles from NewsAPI
    let articles = [];
    try {
        const response = await axios.get(NEWS_API_BASE, {
            params: {
                q: `"${company.name}"`,
                sources: TOP_SOURCES,
                language: 'en',
                sortBy: 'relevancy',
                pageSize: 20,
                apiKey: NEWS_API_KEY
            },
            timeout: 15000
        });

        articles = response.data.articles || [];
        console.log(`📰 [NewsService] Found ${articles.length} articles for ${company.name}`);
    } catch (fetchErr) {
        console.error(`[NewsService] NewsAPI fetch failed for ${company.name}:`, fetchErr.message);
        throw new Error(`NewsAPI fetch failed: ${fetchErr.message}`);
    }

    if (articles.length === 0) {
        // Save record showing no articles found
        await NewsImpact.findOneAndUpdate(
            { company: company._id },
            {
                company: company._id,
                fetchedAt: new Date(),
                articles: [],
                scoreAdjustments: { environmental: 0, social: 0, governance: 0, overall: 0 },
                originalScores: company.latestScores,
                newsAdjustedScores: {
                    environmental: company.latestScores?.environmental || 0,
                    social: company.latestScores?.social || 0,
                    governance: company.latestScores?.governance || 0,
                    overall: company.latestScores?.overall || 0
                },
                articlesProcessed: 0,
                status: 'no_articles'
            },
            { upsert: true, new: true }
        );
        return { success: true, articlesProcessed: 0 };
    }

    // 2. Analyse each article with FinBERT
    const analysedArticles = [];
    for (const art of articles) {
        const text = `${art.title || ''} ${art.description || ''}`.trim();
        if (text.length < 30) continue;

        const { esgCategory, sentiment, sentimentConfidence } = await analyzeWithFinBERT(text);

        if (esgCategory === 'None') continue; // skip non-ESG articles

        // Preliminary impact (will be recalculated in aggregate)
        const rawImpact = (SENTIMENT_VALUE[sentiment] || 0) * sentimentConfidence * 10;
        const scoreImpact = parseFloat(rawImpact.toFixed(2));

        analysedArticles.push({
            title: art.title || 'No title',
            description: art.description || '',
            url: art.url || '',
            source: art.source?.name || 'Unknown',
            publishedAt: art.publishedAt ? new Date(art.publishedAt) : new Date(),
            esgCategory,
            sentiment,
            sentimentConfidence: parseFloat(sentimentConfidence.toFixed(3)),
            scoreImpact,
            reason: generateReason(
                { source: art.source?.name || 'Unknown' },
                esgCategory,
                sentiment,
                scoreImpact
            )
        });
    }

    // 3. Compute aggregate adjustments
    const scoreAdjustments = computeScoreAdjustments(analysedArticles);

    // 4. Build news-adjusted scores (clamped to 0–100)
    const original = company.latestScores || {};
    const newsAdjustedScores = {
        environmental: clamp((original.environmental || 0) + (scoreAdjustments.environmental || 0)),
        social: clamp((original.social || 0) + (scoreAdjustments.social || 0)),
        governance: clamp((original.governance || 0) + (scoreAdjustments.governance || 0)),
        overall: clamp((original.overall || 0) + (scoreAdjustments.overall || 0))
    };

    // 5. Upsert NewsImpact document
    const newsImpact = await NewsImpact.findOneAndUpdate(
        { company: company._id },
        {
            company: company._id,
            fetchedAt: new Date(),
            articles: analysedArticles,
            scoreAdjustments,
            originalScores: {
                environmental: original.environmental || 0,
                social: original.social || 0,
                governance: original.governance || 0,
                overall: original.overall || 0
            },
            newsAdjustedScores,
            articlesProcessed: analysedArticles.length,
            status: 'success',
            errorMessage: ''
        },
        { upsert: true, new: true }
    );

    console.log(`✅ [NewsService] Done for ${company.name}: ${analysedArticles.length} ESG articles processed`);
    return { success: true, articlesProcessed: analysedArticles.length, newsImpact };
}

/**
 * Run news analysis for ALL companies (called by cron)
 */
async function runNewsUpdateForAll() {
    console.log('🕐 [NewsService] Starting scheduled news update for all companies...');
    const companies = await Company.find().select('name latestScores');
    let succeeded = 0, failed = 0;

    for (const company of companies) {
        try {
            await processNewsForCompany(company);
            succeeded++;
        } catch (err) {
            console.error(`[NewsService] Failed for ${company.name}:`, err.message);
            // Save failure record
            await NewsImpact.findOneAndUpdate(
                { company: company._id },
                {
                    company: company._id,
                    fetchedAt: new Date(),
                    status: 'failed',
                    errorMessage: err.message
                },
                { upsert: true, new: true }
            );
            failed++;
        }
    }

    console.log(`✅ [NewsService] Scheduled update complete: ${succeeded} ok, ${failed} failed`);
}

module.exports = { processNewsForCompany, runNewsUpdateForAll };
