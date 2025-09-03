import json
import os
import asyncio
import uuid
import shutil
from typing import Dict, Optional
from pathlib import Path
from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from llama_cloud_services import LlamaParse, LlamaExtract
from llama_cloud import ExtractConfig, ExtractMode, ExtractTarget, ChunkMode
from dotenv import load_dotenv
import tempfile

load_dotenv()

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
try:
    agent = extractor.get_agent(
        id="a025fa19-34ad-4225-b761-40f02d962662"
    )
except Exception as e:
    agent = None
    print(f"Warning: Failed to load LlamaExtract agent. Extraction will not work. Error: {e}")

# Store active WebSocket connections and job statuses
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.job_statuses: Dict[str, Dict] = {}

    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket
        # Send an initial message to confirm connection
        await websocket.send_text(json.dumps({"message": "Connected to WebSocket!", "client_id": client_id}))
        print(f"Client {client_id} connected.")

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]
            print(f"Client {client_id} disconnected.")

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
            except WebSocketDisconnect:
                self.disconnect(client_id)
            except Exception as e:
                print(f"Error sending message to client {client_id}: {e}")
                self.disconnect(client_id)

manager = ConnectionManager()

async def process_file_extraction(client_id: str, job_id: str, file_content: bytes, filename: str):
    """Background task to process file extraction with status updates."""
    temp_file_path = None
    try:
        if not agent:
            raise Exception("LlamaExtract agent not initialized.")

        await manager.send_status_update(
            client_id, job_id, "processing", 
            f"Starting extraction for {filename}..."
        )
        
        print(f"Starting extraction for {filename}")
        # print the jobid
        print(f"Job ID: {job_id}")

        # Create a temporary file with proper cleanup
        with tempfile.NamedTemporaryFile(delete=False, suffix=Path(filename).suffix) as temp_file:
            temp_file.write(file_content)
            temp_file_path = temp_file.name

        await manager.send_status_update(
            client_id, job_id, "processing", 
            f"File saved temporarily, running extraction..."
        )

        # Pass the temporary file path to the agent
        llama_parser_result = agent.extract(temp_file_path)

        await manager.send_status_update(
            client_id, job_id, "completed",
            "Extraction completed successfully!",
            data={
                "file": filename,
                "extracted": llama_parser_result.data
            }
        )

    except Exception as e:
        await manager.send_status_update(
            client_id, job_id, "error",
            f"Extraction failed: {str(e)}"
        )
    finally:
        # Clean up the temporary file
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.unlink(temp_file_path)
            except Exception as cleanup_error:
                print(f"Failed to cleanup temp file {temp_file_path}: {cleanup_error}")

@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    print(f"Client {client_id} connected to WebSocket.")
    await manager.connect(websocket, client_id)
    try:
        # Keep the connection open indefinitely
        while True:
            await websocket.receive_text() # Wait for any message to keep the connection alive
    except WebSocketDisconnect:
        manager.disconnect(client_id)
    except asyncio.CancelledError:
        # This handles server shutdown gracefully
        manager.disconnect(client_id)

@app.post("/extract/{client_id}")
async def extract_document(client_id: str, background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    """Upload a file and start extraction process."""
    if client_id not in manager.active_connections:
        raise HTTPException(
            status_code=400, 
            detail="WebSocket connection not found. Please connect to the WebSocket first."
        )

    # Generate a unique job ID
    job_id = str(uuid.uuid4())
    
    try:
        # Read the file content immediately while the UploadFile is still open
        file_content = await file.read()
        filename = file.filename
        
        # Close the file after reading
        await file.close()
        
        # Pass the file content (bytes) and filename to the background task
        background_tasks.add_task(
            process_file_extraction, 
            client_id, 
            job_id, 
            file_content,
            filename
        )
        
        return {
            "job_id": job_id,
            "client_id": client_id,
            "status": "queued",
            "message": "File uploaded successfully. Processing started."
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(e)}")

@app.get("/status/{job_id}")
async def get_job_status(job_id: str):
    """Get the current status of a job."""
    print(manager.job_statuses)
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