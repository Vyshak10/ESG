import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Container,
    Grid,
    Paper,
    Typography,
    Box,
    AppBar,
    Toolbar,
    Button,
    CircularProgress,
    Alert,
    Chip,
    Divider,
    IconButton,
    Card,
    CardContent,
    Tooltip,
    LinearProgress,
    Link
} from '@mui/material';
import {
    ArrowBack,
    Language,
    Business,
    DarkMode,
    LightMode,
    Refresh,
    Newspaper,
    TrendingUp,
    TrendingDown,
    Remove,
    Nature,
    Groups,
    Gavel,
    OpenInNew,
    InfoOutlined
} from '@mui/icons-material';
import { companiesAPI, newsAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useThemeMode } from '../contexts/ThemeContext';
import ESGScoreCard from '../components/ESGScoreCard';
import { ESGPieChart, ESGBarChart, GreenwashingRiskIndicator } from '../components/Charts';
import ReportCard from '../components/ReportCard';
import ESGTrendChart from '../components/ESGTrendChart';

// ─── helpers ────────────────────────────────────────────────────────────────

const CATEGORY_COLOR = {
    Environmental: 'success',
    Social: 'primary',
    Governance: 'warning'
};

const CATEGORY_ICON = {
    Environmental: <Nature sx={{ fontSize: 16 }} />,
    Social: <Groups sx={{ fontSize: 16 }} />,
    Governance: <Gavel sx={{ fontSize: 16 }} />
};

const SENTIMENT_COLOR = {
    Positive: 'success',
    Negative: 'error',
    Neutral: 'default'
};

function DeltaChip({ value }) {
    if (value === 0 || value === undefined || value === null) {
        return (
            <Chip
                icon={<Remove sx={{ fontSize: 14 }} />}
                label="No change"
                size="small"
                color="default"
                sx={{ fontWeight: 700, fontSize: '0.72rem' }}
            />
        );
    }
    const isPos = value > 0;
    return (
        <Chip
            icon={isPos ? <TrendingUp sx={{ fontSize: 14 }} /> : <TrendingDown sx={{ fontSize: 14 }} />}
            label={`${isPos ? '+' : ''}${value.toFixed(1)} pts`}
            size="small"
            color={isPos ? 'success' : 'error'}
            sx={{ fontWeight: 700, fontSize: '0.72rem' }}
        />
    );
}

// ─── News Impact Section ─────────────────────────────────────────────────────

function NewsImpactSection({ companyId, companyName, originalScores, isAdmin, mode }) {
    const [newsData, setNewsData] = useState(null);
    const [newsLoading, setNewsLoading] = useState(true);
    const [newsError, setNewsError] = useState('');
    const [refreshing, setRefreshing] = useState(false);

    const fetchNews = useCallback(async () => {
        try {
            const res = await newsAPI.getByCompany(companyId);
            setNewsData(res.data.newsImpact);
            setNewsError('');
        } catch (err) {
            setNewsError('Failed to load news impact data.');
            console.error(err);
        } finally {
            setNewsLoading(false);
        }
    }, [companyId]);

    useEffect(() => {
        fetchNews();
    }, [fetchNews]);

    const handleRefresh = async () => {
        setRefreshing(true);
        try {
            await newsAPI.refresh(companyId);
            // Poll after 3s to give background task time to start
            setTimeout(() => {
                fetchNews().finally(() => setRefreshing(false));
            }, 3000);
        } catch (err) {
            setNewsError('Refresh failed. Try again later.');
            setRefreshing(false);
        }
    };

    const cardBg = mode === 'dark'
        ? 'rgba(255,255,255,0.03)'
        : 'rgba(0,0,0,0.02)';

    return (
        <Paper elevation={2} sx={{ p: 3, mb: 4 }}>
            {/* Header */}
            <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                <Box display="flex" alignItems="center" gap={1.5}>
                    <Newspaper sx={{ color: 'primary.main', fontSize: 28 }} />
                    <Box>
                        <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                            📰 News Impact Analysis
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            Powered by Reuters · BBC · Bloomberg · The Guardian · AP News
                        </Typography>
                    </Box>
                </Box>
                <Box display="flex" alignItems="center" gap={1}>
                    {newsData?.fetchedAt && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
                            Last updated: {new Date(newsData.fetchedAt).toLocaleString()}
                        </Typography>
                    )}
                    {isAdmin && (
                        <Tooltip title="Manually refresh news for this company">
                            <span>
                                <IconButton
                                    onClick={handleRefresh}
                                    disabled={refreshing}
                                    color="primary"
                                    size="small"
                                >
                                    {refreshing ? <CircularProgress size={18} /> : <Refresh />}
                                </IconButton>
                            </span>
                        </Tooltip>
                    )}
                </Box>
            </Box>

            <Divider sx={{ mb: 3 }} />

            {newsLoading ? (
                <Box>
                    <LinearProgress />
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: 'center' }}>
                        Loading news impact data…
                    </Typography>
                </Box>
            ) : newsError ? (
                <Alert severity="error">{newsError}</Alert>
            ) : !newsData ? (
                <Alert severity="info" icon={<InfoOutlined />}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>No news analysis available yet.</Typography>
                    <Typography variant="body2" color="text.secondary">
                        News analysis runs automatically every day at 2:00 AM IST.
                        {isAdmin && ' As an admin, you can also trigger a manual refresh using the ↻ button above.'}
                    </Typography>
                </Alert>
            ) : newsData.status === 'no_articles' ? (
                <Alert severity="info">
                    No news articles mentioning <strong>{companyName}</strong> were found in the top publishers at this time.
                    Analysis refreshes daily.
                </Alert>
            ) : newsData.status === 'failed' ? (
                <Alert severity="warning">
                    News fetch encountered an issue: {newsData.errorMessage || 'Unknown error'}. Will retry tomorrow.
                </Alert>
            ) : (
                <>
                    {/* ── Adjusted Score Cards ── */}
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2, color: 'text.secondary' }}>
                        NEWS-ADJUSTED SCORES
                    </Typography>

                    <Grid container spacing={2} mb={4}>
                        {[
                            { label: 'Overall', key: 'overall', color: '#6c63ff' },
                            { label: 'Environmental', key: 'environmental', color: '#2e7d32' },
                            { label: 'Social', key: 'social', color: '#1565c0' },
                            { label: 'Governance', key: 'governance', color: '#e65100' }
                        ].map(({ label, key, color }) => {
                            const original = (originalScores?.[key] ?? 0).toFixed(1);
                            const adjusted = (newsData.newsAdjustedScores?.[key] ?? 0).toFixed(1);
                            const delta = newsData.scoreAdjustments?.[key] ?? 0;

                            return (
                                <Grid item xs={6} md={3} key={key}>
                                    <Paper
                                        elevation={0}
                                        sx={{
                                            p: 2.5,
                                            borderRadius: 3,
                                            border: '1px solid',
                                            borderColor: 'divider',
                                            bgcolor: cardBg,
                                            textAlign: 'center'
                                        }}
                                    >
                                        <Typography
                                            variant="caption"
                                            sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}
                                        >
                                            {label}
                                        </Typography>

                                        {/* Adjusted Score */}
                                        <Typography
                                            variant="h3"
                                            sx={{ fontWeight: 800, color, lineHeight: 1.1, my: 1 }}
                                        >
                                            {adjusted}
                                        </Typography>

                                        {/* Delta chip */}
                                        <DeltaChip value={delta} />

                                        {/* Original score footnote */}
                                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                                            AI score: {original}
                                        </Typography>
                                    </Paper>
                                </Grid>
                            );
                        })}
                    </Grid>

                    {/* ── Summary Banner ── */}
                    {newsData.articles?.length > 0 && (
                        <Alert
                            severity={
                                (newsData.scoreAdjustments?.overall ?? 0) > 0
                                    ? 'success'
                                    : (newsData.scoreAdjustments?.overall ?? 0) < 0
                                        ? 'error'
                                        : 'info'
                            }
                            sx={{ mb: 3, borderRadius: 2 }}
                        >
                            <Typography variant="body2">
                                <strong>{newsData.articlesProcessed}</strong> ESG-relevant news articles analysed from top publishers.
                                {' '}Overall news sentiment <strong>
                                    {(newsData.scoreAdjustments?.overall ?? 0) > 0
                                        ? 'positively'
                                        : (newsData.scoreAdjustments?.overall ?? 0) < 0
                                            ? 'negatively'
                                            : 'neutrally'}
                                </strong> impacts the ESG score by{' '}
                                <strong>{(newsData.scoreAdjustments?.overall ?? 0) > 0 ? '+' : ''}{(newsData.scoreAdjustments?.overall ?? 0).toFixed(1)} points</strong>.
                            </Typography>
                        </Alert>
                    )}

                    {/* ── Article Cards ── */}
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2, color: 'text.secondary' }}>
                        NEWS ARTICLES ({newsData.articles?.length ?? 0} ESG-RELEVANT)
                    </Typography>

                    {newsData.articles?.length === 0 ? (
                        <Alert severity="info">No ESG-relevant articles were detected in the latest fetch.</Alert>
                    ) : (
                        <Grid container spacing={2}>
                            {newsData.articles.map((article, i) => (
                                <Grid item xs={12} md={6} key={i}>
                                    <Card
                                        elevation={0}
                                        sx={{
                                            borderRadius: 3,
                                            border: '1px solid',
                                            borderColor: 'divider',
                                            bgcolor: cardBg,
                                            height: '100%',
                                            transition: 'box-shadow 0.2s',
                                            '&:hover': {
                                                boxShadow: mode === 'dark'
                                                    ? '0 4px 20px rgba(255,255,255,0.08)'
                                                    : '0 4px 20px rgba(0,0,0,0.10)'
                                            }
                                        }}
                                    >
                                        <CardContent>
                                            {/* Article meta row */}
                                            <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" mb={1.5}>
                                                {article.esgCategory && article.esgCategory !== 'None' && (
                                                    <Chip
                                                        icon={CATEGORY_ICON[article.esgCategory]}
                                                        label={article.esgCategory}
                                                        size="small"
                                                        color={CATEGORY_COLOR[article.esgCategory] || 'default'}
                                                        variant="outlined"
                                                        sx={{ fontWeight: 600, fontSize: '0.7rem' }}
                                                    />
                                                )}
                                                <Chip
                                                    label={article.sentiment}
                                                    size="small"
                                                    color={SENTIMENT_COLOR[article.sentiment] || 'default'}
                                                    sx={{ fontWeight: 600, fontSize: '0.7rem' }}
                                                />
                                                <DeltaChip value={article.scoreImpact} />
                                                <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                                                    {article.source}
                                                </Typography>
                                            </Box>

                                            {/* Headline */}
                                            <Typography
                                                variant="body1"
                                                sx={{ fontWeight: 700, mb: 1, lineHeight: 1.4 }}
                                            >
                                                {article.url ? (
                                                    <Link
                                                        href={article.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        underline="hover"
                                                        color="inherit"
                                                        sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}
                                                    >
                                                        {article.title}
                                                        <OpenInNew sx={{ fontSize: 14, mt: 0.4, flexShrink: 0, opacity: 0.6 }} />
                                                    </Link>
                                                ) : article.title}
                                            </Typography>

                                            {/* Description */}
                                            {article.description && (
                                                <Typography
                                                    variant="body2"
                                                    color="text.secondary"
                                                    sx={{ mb: 1.5, fontSize: '0.8rem', lineHeight: 1.5 }}
                                                >
                                                    {article.description.length > 180
                                                        ? article.description.substring(0, 180) + '…'
                                                        : article.description}
                                                </Typography>
                                            )}

                                            <Divider sx={{ my: 1.5 }} />

                                            {/* Reason */}
                                            <Box
                                                sx={{
                                                    bgcolor: mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                                                    borderRadius: 2,
                                                    p: 1.5
                                                }}
                                            >
                                                <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                                    Score Impact Reason
                                                </Typography>
                                                <Typography variant="body2" sx={{ fontSize: '0.8rem', lineHeight: 1.5 }}>
                                                    {article.reason}
                                                </Typography>
                                            </Box>

                                            {/* Date */}
                                            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5, textAlign: 'right' }}>
                                                {article.publishedAt
                                                    ? new Date(article.publishedAt).toLocaleDateString(undefined, {
                                                        year: 'numeric', month: 'short', day: 'numeric'
                                                    })
                                                    : ''}
                                            </Typography>
                                        </CardContent>
                                    </Card>
                                </Grid>
                            ))}
                        </Grid>
                    )}
                </>
            )}
        </Paper>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const CompanyDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { mode, toggleTheme } = useThemeMode();
    const [company, setCompany] = useState(null);
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [refreshing, setRefreshing] = useState(false);

    const dashboardRoute = user?.role === 'admin' ? '/admin/dashboard' : '/dashboard';

    useEffect(() => {
        fetchCompanyDetails();

        const intervalId = setInterval(() => {
            fetchCompanyDetails(true);
        }, 10000);

        return () => clearInterval(intervalId);
    }, [id]);

    const fetchCompanyDetails = async (silent = false) => {
        try {
            if (!silent) setLoading(true);
            else setRefreshing(true);

            const response = await companiesAPI.getById(id);
            setCompany(response.data.company);
            setReports(response.data.reports);
            setError('');
        } catch (err) {
            if (!silent) setError('Failed to load company details');
            console.error(err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
                <CircularProgress />
            </Box>
        );
    }

    if (error || !company) {
        return (
            <Container maxWidth="md" sx={{ mt: 4 }}>
                <Alert severity="error">{error || 'Company not found'}</Alert>
                <Button onClick={() => navigate(dashboardRoute)} sx={{ mt: 2 }}>
                    Back to Dashboard
                </Button>
            </Container>
        );
    }

    const hasScores = company.latestScores.lastUpdated;

    return (
        <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
            <AppBar
                position="sticky"
                elevation={0}
                sx={{
                    backdropFilter: 'blur(20px)',
                    backgroundColor: mode === 'dark' ? 'rgba(30, 41, 59, 0.8)' : 'rgba(255, 255, 255, 0.8)',
                    borderBottom: 1,
                    borderColor: 'divider'
                }}
            >
                <Toolbar>
                    <Button
                        onClick={() => navigate(dashboardRoute)}
                        startIcon={<ArrowBack />}
                        sx={{ color: 'text.primary' }}
                    >
                        Back
                    </Button>
                    <Typography variant="h6" component="div" sx={{ flexGrow: 1, ml: 2, fontWeight: 600 }}>
                        {company.name}
                    </Typography>
                    {refreshing && (
                        <Chip label="Refreshing..." size="small" color="primary" sx={{ mr: 2 }} />
                    )}
                    <IconButton onClick={() => fetchCompanyDetails()} title="Refresh data" sx={{ color: 'text.primary' }}>
                        <Refresh />
                    </IconButton>
                    <IconButton onClick={toggleTheme} sx={{ color: 'text.primary' }}>
                        {mode === 'dark' ? <LightMode /> : <DarkMode />}
                    </IconButton>
                </Toolbar>
            </AppBar>

            <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
                {/* Company Header */}
                <Paper elevation={2} sx={{ p: 3, mb: 4 }}>
                    <Box display="flex" alignItems="center" mb={2}>
                        <Business sx={{ fontSize: 48, mr: 2, color: 'primary.main' }} />
                        <Box>
                            <Typography variant="h3" gutterBottom>
                                {company.name}
                            </Typography>
                            {company.industry && (
                                <Chip label={company.industry} color="primary" />
                            )}
                        </Box>
                    </Box>

                    {company.description && (
                        <Typography variant="body1" color="text.secondary" paragraph>
                            {company.description}
                        </Typography>
                    )}

                    {company.website && (
                        <Button
                            startIcon={<Language />}
                            href={company.website}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Visit Website
                        </Button>
                    )}
                </Paper>

                {!hasScores ? (
                    <Alert severity="info">
                        No ESG reports have been processed for this company yet.
                    </Alert>
                ) : (
                    <>
                        {/* AI-Analysed ESG Scores */}
                        <Paper elevation={2} sx={{ p: 3, mb: 4 }}>
                            <Typography variant="h5" gutterBottom sx={{ fontWeight: 600, mb: 3 }}>
                                ESG Performance Scores
                            </Typography>

                            <Grid container spacing={3}>
                                <Grid item xs={12} sm={6} md={3}>
                                    <ESGScoreCard
                                        title="Overall ESG Score"
                                        score={company.latestScores.overall}
                                        subtitle={`Last updated: ${new Date(company.latestScores.lastUpdated).toLocaleDateString()}`}
                                        showGrade={true}
                                    />
                                </Grid>
                                <Grid item xs={12} sm={6} md={3}>
                                    <ESGScoreCard
                                        title="Environmental"
                                        score={company.latestScores.environmental}
                                        subtitle="Climate, Energy, Resources"
                                    />
                                </Grid>
                                <Grid item xs={12} sm={6} md={3}>
                                    <ESGScoreCard
                                        title="Social"
                                        score={company.latestScores.social}
                                        subtitle="Labor, Community, Diversity"
                                    />
                                </Grid>
                                <Grid item xs={12} sm={6} md={3}>
                                    <ESGScoreCard
                                        title="Governance"
                                        score={company.latestScores.governance}
                                        subtitle="Ethics, Compliance, Leadership"
                                    />
                                </Grid>
                            </Grid>
                        </Paper>

                        {/* Charts */}
                        <Grid container spacing={3} mb={4}>
                            <Grid item xs={12} md={6}>
                                <ESGPieChart data={company.latestScores} />
                            </Grid>
                            <Grid item xs={12} md={6}>
                                <ESGBarChart data={company.latestScores} />
                            </Grid>
                        </Grid>

                        {/* Greenwashing Risk */}
                        {company.greenwashingRisk && (
                            <Box mb={4}>
                                <GreenwashingRiskIndicator risk={company.greenwashingRisk} />
                            </Box>
                        )}

                        {/* ── News Impact Section ── */}
                        <NewsImpactSection
                            companyId={id}
                            companyName={company.name}
                            originalScores={company.latestScores}
                            isAdmin={user?.role === 'admin'}
                            mode={mode}
                        />
                    </>
                )}

                {/* Reports History */}
                <Paper elevation={2} sx={{ p: 3, mb: 4 }}>
                    <Typography variant="h5" gutterBottom sx={{ fontWeight: 600 }}>
                        📊 Reports History ({reports.length} {reports.length === 1 ? 'report' : 'reports'})
                    </Typography>
                    <Divider sx={{ mb: 3 }} />

                    {reports.length === 0 ? (
                        <Alert severity="info">
                            No reports have been uploaded yet. Upload your first sustainability report to get started!
                        </Alert>
                    ) : (
                        <>
                            {reports.filter(r => r.processingStatus === 'completed').length >= 2 && (
                                <Box sx={{ mb: 4, p: 2, bgcolor: 'background.default', borderRadius: 2 }}>
                                    <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
                                        ESG Score Trends Over Time
                                    </Typography>
                                    <Box sx={{ width: '100%', height: 300, mt: 2 }}>
                                        <ESGTrendChart reports={reports} />
                                    </Box>
                                </Box>
                            )}

                            <Box>
                                {reports.map((report, index) => (
                                    <ReportCard
                                        key={report._id}
                                        report={report}
                                        isLatest={index === 0}
                                        onDelete={() => fetchCompanyDetails()}
                                    />
                                ))}
                            </Box>
                        </>
                    )}
                </Paper>
            </Container>
        </Box>
    );
};

export default CompanyDetail;
