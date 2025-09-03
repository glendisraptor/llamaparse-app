import json
import os
from fastapi import FastAPI, File, UploadFile
from llama_cloud_services import LlamaParse, LlamaExtract
from llama_cloud import ExtractConfig, ExtractMode, ChunkMode, ExtractTarget
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

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


@app.post("/extract")
async def extract_document(file: UploadFile = File(...)):
    """Upload a file and extract structured data."""
    file_path = f"/tmp/{file.filename}"
    
    with open(file_path, "wb") as f:
        f.write(await file.read())

    llama_parser_result = agent.extract(file_path)

    return {
        "file": file.filename,
        "extracted": llama_parser_result.data
    }
