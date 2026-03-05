const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const Company = require('../models/Company');
const Report = require('../models/Report');

class ESGProcessorService {
    constructor() {
        this.pythonServiceUrl = process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:8000';
    }

    /**
     * Process a PDF report using the Python FastAPI service
     * @param {string} filePath - Path to the PDF file
     * @param {string} companyId - MongoDB company ID
     * @param {string} userId - User ID who uploaded the report
     * @param {string} originalName - Original filename
     * @param {number} fileSize - File size in bytes
     * @returns {Promise<Object>} - Processing result
     */
    async processReport(filePath, companyId, userId, originalName, fileSize) {
        try {
            // Get company details
            const company = await Company.findById(companyId);
            if (!company) {
                throw new Error('Company not found');
            }

            // Extract year from filename (e.g., "2023-report.pdf" -> 2023)
            const yearMatch = originalName.match(/\b(19|20)\d{2}\b/);
            const extractedYear = yearMatch ? parseInt(yearMatch[0]) : new Date().getFullYear();

            // Create report record in database
            const report = new Report({
                company: companyId,
                fileName: filePath,
                originalName,
                fileSize,
                processingStatus: 'processing',
                uploadedBy: userId,
                referenceYear: extractedYear
            });

            await report.save();

            console.log(`Processing report ${report._id} for company ${company.name}`);

            try {
                // 1. Submit Analysis Job
                console.log(`Submitting analysis job to Python service...`);
                let taskId;
                try {
                    const formData = new FormData();
                    formData.append('file', fs.createReadStream(filePath));
                    formData.append('company_name', company.name);

                    const submitResponse = await axios.post(
                        `${this.pythonServiceUrl}/analyze`,
                        formData,
                        {
                            headers: formData.getHeaders(),
                            timeout: 10000 // Short timeout for submission
                        }
                    );
                    taskId = submitResponse.data.task_id;
                    console.log(`Job submitted. Task ID: ${taskId}`);
                } catch (submitError) {
                    console.error('Failed to submit analysis job:', submitError.message);
                    throw new Error(`Failed to start analysis: ${submitError.message}`);
                }

                // 2. Poll for Results
                let analysisResult = null;
                let attempts = 0;
                const maxAttempts = 240; // 20 minutes (polling every 5s)
                const pollInterval = 5000; // 5 seconds

                while (attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, pollInterval));
                    attempts++;

                    try {
                        const statusResponse = await axios.get(`${this.pythonServiceUrl}/results/${taskId}`);
                        const statusData = statusResponse.data;
                        console.log(`Polling Task ${taskId}: ${statusData.status} (attempt ${attempts}/${maxAttempts})`);

                        if (statusData.status === 'completed') {
                            analysisResult = statusData.result;
                            break;
                        } else if (statusData.status === 'failed') {
                            throw new Error(statusData.error || 'Analysis failed in Python service');
                        }
                        // If 'processing', continue loop
                    } catch (pollError) {
                        console.error(`Polling error for Task ${taskId}:`, pollError.message);
                        if (attempts > 5 && pollError.response?.status === 404) {
                            throw new Error('Task ID lost by server');
                        }
                    }
                }

                if (!analysisResult) {
                    throw new Error('Analysis timed out after 20 minutes');
                }

                // Update report with analysis results
                report.processingStatus = 'completed';
                report.processedAt = new Date();

                // Extract scores (Convert 0-1 to 0-100 for compatibility)
                report.scores = {
                    overall: (analysisResult.overall_score || 0) * 100,
                    environmental: (analysisResult.environmental?.score || 0) * 100,
                    social: (analysisResult.social?.score || 0) * 100,
                    governance: (analysisResult.governance?.score || 0) * 100
                };

                // Extract or Estimate Greenwashing Risk
                // New Python model doesn't explicitly calculate this yet, so we estimate or default.
                // Logic: If average score is very low but description is glowing? 
                // For now, default to Low to avoid false alarms.
                report.greenwashingRisk = {
                    level: 'Low',
                    score: 10,
                    alertCount: 0,
                    description: "Automated risk assessment not fully available in this version."
                };

                // Flatten Evidence for Greenwashing Alerts/Insights
                const evidence = [];
                if (analysisResult.environmental?.key_evidence) evidence.push(...analysisResult.environmental.key_evidence);
                if (analysisResult.social?.key_evidence) evidence.push(...analysisResult.social.key_evidence);
                if (analysisResult.governance?.key_evidence) evidence.push(...analysisResult.governance.key_evidence);

                // Store analysis details
                report.analysisDetails = {
                    totalSegmentsAnalyzed: 0, // Not provided in new API
                    categoryDistribution: {
                        Environmental: 0,
                        Social: 0,
                        Governance: 0
                    },
                    insights: [
                        `Environmental Sentiment: ${analysisResult.environmental?.sentiment || 'N/A'}`,
                        `Social Sentiment: ${analysisResult.social?.sentiment || 'N/A'}`,
                        `Governance Sentiment: ${analysisResult.governance?.sentiment || 'N/A'}`
                    ],
                    greenwashingAlerts: evidence.map(text => ({
                        page: 0,
                        category: "General",
                        text: text,
                        riskLevel: "Info",
                        reason: "Key Evidence identified by AI"
                    }))
                };

                await report.save();

                // Update company's latest scores
                company.latestScores = {
                    overall: report.scores.overall,
                    environmental: report.scores.environmental,
                    social: report.scores.social,
                    governance: report.scores.governance,
                    lastUpdated: new Date()
                };

                company.greenwashingRisk = report.greenwashingRisk;
                company.reportCount += 1;

                await company.save();

                console.log(`Successfully processed report ${report._id}`);

                return {
                    success: true,
                    report,
                    company
                };

            } catch (analysisError) {
                // Update report status to failed
                report.processingStatus = 'failed';
                report.errorMessage = analysisError.message || 'Analysis failed';
                await report.save();

                throw analysisError;
            }

        } catch (error) {
            console.error('Error processing report:', error);
            throw error;
        }
    }

    async checkServiceHealth() {
        try {
            console.log(`Checking Python service health at ${this.pythonServiceUrl}/health...`);
            const response = await axios.get(`${this.pythonServiceUrl}/health`, {
                timeout: 10000 // Increased timeout
            });
            console.log(`Python service health response: ${response.status} ${JSON.stringify(response.data)}`);
            return {
                isHealthy: response.data.status === 'healthy',
                status: response.data.status,
                details: response.data.details || response.data.error
            };
        } catch (error) {
            console.error(`Python service health check failed to ${this.pythonServiceUrl}:`, error.message);
            if (error.response) {
                console.error('Error response data:', error.response.data);
            }
            return {
                isHealthy: false,
                status: 'unreachable',
                details: error.message
            };
        }
    }
}

module.exports = new ESGProcessorService();
