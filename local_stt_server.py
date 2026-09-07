#!/usr/bin/env python3
"""CodeNotes · a VDX product — local Whisper STT server.

OpenAI-compatible /v1/audio/transcriptions endpoint that serves the SAME
faster-whisper model the Jyotish pipeline already uses on this machine
(Systran/faster-distil-whisper-large-v3, weights already downloaded). No system
ffmpeg needed — PyAV decodes the audio.

The model loads once and is kept hot, so live CodeNotes transcription is fast.

Run:
    python local_stt_server.py            # default port 8010
    python local_stt_server.py --port 8011 --model base

Point CodeNotes' Settings → "STT endpoint" at:
    http://localhost:8010/v1/audio/transcriptions
"""
import argparse
import io
import re
import sys
import threading

import numpy as np
import av
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

MODEL_NAME = "Systran/faster-distil-whisper-large-v3"
DEVICE = "cpu"
COMPUTE_TYPE = "int8"
CPU_THREADS = 4

app = FastAPI(title="CodeNotes local Whisper STT")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_model = None
_model_lock = threading.Lock()


def get_model():
    global _model
    with _model_lock:
        if _model is None:
            from faster_whisper import WhisperModel
            _model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE_TYPE, cpu_threads=CPU_THREADS)
        return _model


def decode_to_mono_16k(data: bytes, ext: str) -> np.ndarray:
    """Decode any audio/video bytes to mono 16kHz float32 using PyAV."""
    try:
        container = av.open(io.BytesIO(data))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"could not decode audio: {e}")
    resampler = av.AudioResampler(format="fltp", layout="mono", rate=16000)
    samples = []
    for frame in container.decode(audio=0):
        frame.pts = None
        for rframe in resampler.resample(frame):
            arr = rframe.to_ndarray()[0]
            samples.append(arr.astype(np.float32))
    if samples:
        return np.concatenate(samples)
    return np.zeros(16000, dtype=np.float32)  # ~1s silence fallback


@app.post("/v1/audio/transcriptions")
async def transcribe(file: UploadFile = File(...), model: str = Form(None), language: str = Form(None)):
    data = await file.read()
    ext = (file.filename or "audio.wav").rsplit(".", 1)[-1].lower()
    if not data:
        raise HTTPException(status_code=400, detail="empty audio")
    audio = decode_to_mono_16k(data, ext)
    model_name = model or MODEL_NAME
    kw = {}
    if language:
        kw["language"] = language
    m = get_model()
    segments, info = m.transcribe(audio, beam_size=5, word_timestamps=False, **kw)
    text = "".join(s.text for s in segments).strip()
    return {
        "text": text,
        "language": getattr(info, "language", None),
        "duration": round(getattr(info, "duration", 0.0), 2),
        "model": model_name,
        "source": "codenotes-local-whisper",
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "device": DEVICE,
        "hot": _model is not None,
    }


def main():
    global MODEL_NAME, DEVICE
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8010)
    ap.add_argument("--model", default=MODEL_NAME, help="faster-whisper model id")
    ap.add_argument("--device", default=DEVICE, help="cpu or cuda")
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()
    MODEL_NAME, DEVICE = args.model, args.device
    print(f"[code-notes stt] loading {MODEL_NAME} on {DEVICE} (first request warms it)...")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
