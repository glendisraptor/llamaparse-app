import json
import os
import asyncio
import uuid
from typing import Dict
from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from llama_cloud_services import LlamaParse, LlamaExtract
from llama_cloud import ExtractConfig, ExtractMode, ChunkMode, ExtractTarget
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize parser & extractor
parser = LlamaParse(
    api_key=os.getenv("LLAMA_CLOUD_API_KEY"),
    num_workers=4,
    verbose=True,
    language="en",
)

extractor = LlamaExtract(api_key=os.getenv("LLAMA_CLOUD_API_KEY"))

config = ExtractConfig(
    extraction_mode=ExtractMode.MULTIMODAL,
    extraction_target=ExtractTarget.PER_DOC,
    system_prompt="Focus on the company data",
    chunk_mode=ChunkMode.PAGE,
    high_resolution_mode=True,
    invalidate_cache=False,
    cite_sources=True,
    use_reasoning=True,
    confidence_scores=True
)

# Example: use a pre-created agent (from your dashboard)
agent = extractor.get_agent(
    id="a025fa19-34ad-4225-b761-40f02d962662"
)

# Store active WebSocket connections and job statuses
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.job_statuses: Dict[str, Dict] = {}

    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]

    async def send_status_update(self, client_id: str, job_id: str, status: str, message: str = "", data: dict = None):
        if client_id in self.active_connections:
            try:
                update = {
                    "job_id": job_id,
                    "status": status,
                    "message": message,
                    "timestamp": asyncio.get_event_loop().time()
                }
                if data:
                    update["data"] = data
                
                await self.active_connections[client_id].send_text(json.dumps(update))
                
                # Update job status
                self.job_statuses[job_id] = update
            except:
                # Connection might be closed, remove it
                self.disconnect(client_id)

manager = ConnectionManager()

async def process_file_extraction(client_id: str, job_id: str, file_path: str, filename: str):
    """Background task to process file extraction with status updates."""
    try:
        # Update status: Starting
        await manager.send_status_update(
            client_id, job_id, "processing", 
            f"Starting extraction for {filename}..."
        )
        
        # Simulate parsing phase
        await manager.send_status_update(
            client_id, job_id, "processing", 
            "Parsing document with LlamaParse..."
        )
        
        # Add a small delay to simulate parsing time
        await asyncio.sleep(1)
        
        # Update status: Extracting
        await manager.send_status_update(
            client_id, job_id, "processing", 
            "Extracting structured data..."
        )
        
        # Perform the actual extraction
        llama_parser_result = agent.extract(file_path)
        
        # Update status: Completed
        await manager.send_status_update(
            client_id, job_id, "completed", 
            "Extraction completed successfully!",
            data={
                "file": filename,
                "extracted": llama_parser_result.data
            }
        )
        
        # Clean up the temporary file
        os.remove(file_path)
        
    except Exception as e:
        # Update status: Error
        await manager.send_status_update(
            client_id, job_id, "error", 
            f"Extraction failed: {str(e)}"
        )
        
        # Clean up the temporary file even on error
        if os.path.exists(file_path):
            os.remove(file_path)

@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await manager.connect(websocket, client_id)
    try:
        while True:
            # Keep the connection alive and listen for any client messages
            data = await websocket.receive_text()
            # You can handle client messages here if needed
            await websocket.send_text(f"Message received: {data}")
    except WebSocketDisconnect:
        manager.disconnect(client_id)

@app.post("/extract")
async def extract_document(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    """Upload a file and start extraction process."""
    
    # Generate unique IDs
    job_id = str(uuid.uuid4())
    client_id = str(uuid.uuid4())  # In a real app, you'd get this from the request
    
    # Save the file temporarily
    file_path = f"/tmp/{job_id}_{file.filename}"
    
    with open(file_path, "wb") as f:
        f.write(await file.read())
    
    # Start background task for extraction
    background_tasks.add_task(
        process_file_extraction, 
        client_id, 
        job_id, 
        file_path, 
        file.filename
    )
    
    return {
        "job_id": job_id,
        "client_id": client_id,
        "status": "queued",
        "message": "File uploaded successfully. Processing started."
    }

@app.get("/status/{job_id}")
async def get_job_status(job_id: str):
    """Get the current status of a job."""
    if job_id in manager.job_statuses:
        return manager.job_statuses[job_id]
    else:
        return {"job_id": job_id, "status": "not_found", "message": "Job not found"}

@app.get("/")
async def root():
    return {"message": "Company Profile Extractor API with WebSocket support"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)