import asyncio
import uuid
import logging
import os
import tempfile
from datetime import datetime
from typing import Optional, Dict, Any

from fastapi import FastAPI, File, UploadFile, HTTPException, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import your analyzer class
from esg_analyzer import ESGAnalyzer

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="ESG Analytics API",
    description="AI-powered ESG analysis with Background Processing",
    version="2.1.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- GLOBAL STATE (In-Memory Database) ---
# Stores the results of the analysis. 
# In a real startup, you'd use Redis or a SQL Database.
analysis_jobs: Dict[str, dict] = {}

# Global variable for the model (starts as None)
esg_analyzer: Optional[ESGAnalyzer] = None

# --- LAZY LOADER ---
def get_analyzer():
    """
    Loads the model only when needed. 
    Prevents server crash on startup.
    """
    global esg_analyzer
    if esg_analyzer is not None:
        return esg_analyzer

    logger.info("Initializing ESG Analyzer model (First run)...")
    try:
        esg_analyzer = ESGAnalyzer()
        logger.info("ESG Analyzer loaded successfully!")
        return esg_analyzer
    except Exception as e:
        logger.error(f"CRITICAL: Failed to load model: {e}")
        return None

# --- BACKGROUND WORKER ---
def process_analysis_task(task_id: str, file_path: str, company_name: str):
    """
    This function runs in the background.
    """
    logger.info(f"Task {task_id}: Starting background analysis for {company_name}")
    
    try:
        # Load model (this might take time on first run)
        analyzer = get_analyzer()
        
        if not analyzer:
            raise Exception("Model failed to initialize on server.")

        # Run the heavy analysis
        result = analyzer.analyze_document(file_path, company_name)
        
        # Check for internal errors in result
        if "error" in result:
            analysis_jobs[task_id] = {"status": "failed", "error": result["error"]}
        else:
            analysis_jobs[task_id] = {"status": "completed", "result": result}
            
        logger.info(f"Task {task_id}: Completed successfully.")

    except Exception as e:
        logger.error(f"Task {task_id}: Failed with error: {e}")
        analysis_jobs[task_id] = {"status": "failed", "error": str(e)}
        
    finally:
        # Cleanup temp file
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except:
                pass

# --- API MODELS ---
class TaskResponse(BaseModel):
    task_id: str
    status: str
    message: str

class ResultResponse(BaseModel):
    task_id: str
    status: str
    result: Optional[dict] = None
    error: Optional[str] = None

class TextAnalysisRequest(BaseModel):
    text: str

class TextAnalysisResponse(BaseModel):
    esg_category: str
    sentiment: str
    sentiment_confidence: float

# --- ENDPOINTS ---

@app.get("/health")
async def health_check():
    """Simple health check"""
    return {
        "status": "healthy",
        "model_loaded": esg_analyzer is not None,
        "active_jobs": len(analysis_jobs)
    }

@app.post("/analyze-text", response_model=TextAnalysisResponse)
async def analyze_text(request: TextAnalysisRequest):
    """
    Analyse a raw text string (e.g. a news headline + description) for:
    - ESG Category: Environmental / Social / Governance / None
    - Sentiment:    Positive / Negative / Neutral
    Used by the Node.js newsService to process news articles.
    """
    analyzer = get_analyzer()
    if not analyzer:
        raise HTTPException(status_code=503, detail="Model not loaded yet. Try again shortly.")

    text = request.text.strip()
    if len(text) < 10:
        raise HTTPException(status_code=400, detail="Text too short for analysis")

    try:
        # Stage 1: ESG Categorization
        cat_output = analyzer.nlp_esg(text, truncation=True, max_length=512, top_k=1)
        esg_category = cat_output[0]['label']
        cat_score = cat_output[0]['score']

        # Keyword rescue for Governance (same logic as PDF analyzer)
        GOV_KEYWORDS = [
            "board", "executive compensation", "whistleblower", "code of conduct",
            "anti-corruption", "bribery", "audit", "risk management",
            "shareholder", "compliance", "ethics", "remuneration",
            "independent director", "gdpr", "data privacy"
        ]
        if esg_category == "None" or cat_score < 0.6:
            if any(kw in text.lower() for kw in GOV_KEYWORDS):
                esg_category = "Governance"
                cat_score = 0.85
            else:
                esg_category = "None"

        # Stage 2: Sentiment Analysis
        sent_output = analyzer.nlp_tone(text, truncation=True, max_length=512, top_k=1)
        sentiment = sent_output[0]['label']
        sentiment_confidence = round(float(sent_output[0]['score']), 4)

        return {
            "esg_category": esg_category,
            "sentiment": sentiment,
            "sentiment_confidence": sentiment_confidence
        }

    except Exception as e:
        logger.error(f"Text analysis failed: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@app.post("/analyze", response_model=TaskResponse)
async def start_analysis(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    company_name: str = Form(...)
):
    """
    Step 1: Upload file and start background job.
    Returns a Task ID immediately.
    """
    # Validate PDF
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    try:
        # Generate ID
        task_id = str(uuid.uuid4())
        
        # Save file to disk so background worker can read it
        fd, temp_path = tempfile.mkstemp(suffix=".pdf")
        with os.fdopen(fd, 'wb') as tmp:
            content = await file.read()
            tmp.write(content)

        # Initialize job status
        analysis_jobs[task_id] = {"status": "processing"}

        # Start background task
        background_tasks.add_task(process_analysis_task, task_id, temp_path, company_name)

        return {
            "task_id": task_id,
            "status": "processing",
            "message": "Analysis started in background"
        }

    except Exception as e:
        logger.error(f"Upload failed: {e}")
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@app.get("/results/{task_id}", response_model=ResultResponse)
async def get_results(task_id: str):
    """
    Step 2: Poll this endpoint to get the result.
    """
    job = analysis_jobs.get(task_id)
    
    if not job:
        raise HTTPException(status_code=404, detail="Task ID not found")
        
    return {
        "task_id": task_id,
        "status": job["status"],
        "result": job.get("result"),
        "error": job.get("error")
    }

if __name__ == "__main__":
    import uvicorn
    # workers=1 is SAFER for heavy AI models to prevent RAM crashes
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True, workers=1)
