import os
import sys
import site

# Environment fixes for Windows
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
os.environ["HF_HUB_OFFLINE"] = "0"

def add_cuda_dlls():
    if os.name != "nt": return
    
    # Try to find site-packages dynamically
    search_paths = []
    try:
        import site
        search_paths.extend(site.getsitepackages())
        if site.getusersitepackages():
            search_paths.append(site.getusersitepackages())
    except Exception:
        pass
    
    # Add current venv if it exists
    base_dir = os.path.dirname(os.path.abspath(__file__))
    search_paths.append(os.path.join(base_dir, "venv", "Lib", "site-packages"))
    
    # Also check where 'nvidia' might be in the current python path
    for path in sys.path:
        if "site-packages" in path:
            search_paths.append(path)

    found_any = False
    for sp in set(search_paths):
        if not os.path.exists(sp): continue
        
        cublas_path = os.path.join(sp, "nvidia", "cublas", "bin")
        cudnn_path = os.path.join(sp, "nvidia", "cudnn", "bin")
        cudart_path = os.path.join(sp, "nvidia", "cuda_runtime", "bin")
        
        for p in (cublas_path, cudnn_path, cudart_path):
            if os.path.exists(p):
                try:
                    os.add_dll_directory(p)
                    print(f"[DEBUG] Successfully added CUDA DLL path: {p}")
                    found_any = True
                except Exception as e:
                    print(f"[DEBUG] Failed to add CUDA DLL path {p}: {e}")
                
                # Also add to PATH for good measure (some libraries still look there)
                if p not in os.environ["PATH"]:
                    os.environ["PATH"] = p + os.pathsep + os.environ.get("PATH", "")

    if not found_any:
        print("[DEBUG] No NVIDIA CUDA DLLs found in site-packages. If you have a GPU, consider: pip install nvidia-cublas-cu12 nvidia-cudnn-cu12")

add_cuda_dlls()

import shutil
import uuid
import subprocess
import asyncio
import sqlite3
import json
import queue
import threading
import time
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, BackgroundTasks, Request, status
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from faster_whisper import WhisperModel
import srt
import datetime
import re
from pythainlp.util import normalize, num_to_thaiword
from pythainlp.tokenize import word_tokenize
from openai import OpenAI

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

app = FastAPI(title="Auto Thai Subtitler")

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    print(f"[DEBUG] Validation Error: {exc.errors()}")
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "body": exc.body},
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1. OPTIMIZATION: Best Accuracy with Turbo Model
MODEL_SIZE = "large-v3-turbo" 

try:
    print(f"Loading Whisper model '{MODEL_SIZE}' on GPU...")
    # Use float16 for maximum precision on GPU
    whisper_model = WhisperModel(MODEL_SIZE, device="cuda", compute_type="float16")
    print("[OK] Whisper model loaded!")
except Exception as e:
    print(f"[WARN] GPU Loading failed, falling back to CPU. Error: {e}")
    whisper_model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")

lm_client = OpenAI(base_url="http://localhost:1234/v1", api_key="lm-studio")

UPLOAD_DIR = "temp_uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ----------------- SQLITE DATABASE INTEGRATION -----------------
DB_PATH = "database.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            task_id TEXT PRIMARY KEY,
            step INTEGER,
            status TEXT,
            progress INTEGER,
            result_url TEXT,
            waiting_for_user INTEGER,
            step_time TEXT,
            raw_subtitles TEXT,
            settings TEXT
        )
    """)
    conn.commit()
    conn.close()

init_db()

def get_db_task(task_id: str) -> Optional[dict]:
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT step, status, progress, result_url, waiting_for_user, step_time, raw_subtitles, settings 
            FROM tasks WHERE task_id = ?
        """, (task_id,))
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return None
        
        raw_subs = None
        if row[6]:
            try:
                raw_subs = json.loads(row[6])
            except Exception:
                pass
                
        settings = None
        if row[7]:
            try:
                settings = json.loads(row[7])
            except Exception:
                pass
                
        return {
            "step": row[0],
            "status": row[1],
            "progress": row[2],
            "result_url": row[3],
            "waiting_for_user": bool(row[4]),
            "step_time": row[5],
            "raw_subtitles": raw_subs,
            "settings": settings
        }
    except Exception as e:
        print(f"[DB ERROR] get_db_task failed: {e}")
        return None

def save_db_task(task_id: str, data: dict):
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        existing = get_db_task(task_id)
        if not existing:
            existing = {
                "step": 0,
                "status": "",
                "progress": 0,
                "result_url": None,
                "waiting_for_user": False,
                "step_time": None,
                "raw_subtitles": None,
                "settings": None
            }
        
        # Merge new keys
        for k, v in data.items():
            existing[k] = v
            
        raw_subs_str = json.dumps(existing["raw_subtitles"]) if existing["raw_subtitles"] is not None else None
        settings_str = json.dumps(existing["settings"]) if existing["settings"] is not None else None
        
        cursor.execute("""
            INSERT OR REPLACE INTO tasks (task_id, step, status, progress, result_url, waiting_for_user, step_time, raw_subtitles, settings)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            task_id,
            existing["step"],
            existing["status"],
            existing["progress"],
            existing["result_url"],
            1 if existing["waiting_for_user"] else 0,
            existing["step_time"],
            raw_subs_str,
            settings_str
        ))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[DB ERROR] save_db_task failed: {e}")

# Transparent Proxy Classes to preserve dict interface compatibility in existing code
class TaskDict(dict):
    def __init__(self, task_id, *args, **kwargs):
        self.task_id = task_id
        super().__init__(*args, **kwargs)
        
    def __setitem__(self, key, value):
        super().__setitem__(key, value)
        save_db_task(self.task_id, self)

class TaskDbProxy(dict):
    def __getitem__(self, key):
        t = get_db_task(key)
        if t is None:
            raise KeyError(key)
        return TaskDict(key, t)
    
    def __setitem__(self, key, value):
        save_db_task(key, value)
        
    def __contains__(self, key):
        return get_db_task(key) is not None
        
    def get(self, key, default=None):
        t = get_db_task(key)
        if t is None:
            return default
        return TaskDict(key, t)

tasks = TaskDbProxy()

# ----------------- SINGLE CONCURRENCY TASK QUEUE -----------------
task_queue = queue.Queue()

def prepare_video_task(task_id: str, input_video_path: str, session_dir: str, use_llm: bool = True, custom_vocab: str = ""):
    """Core audio extraction and transcription task."""
    start_total = time.time()
    try:
        audio_path = os.path.join(session_dir, "audio.wav")

        # Step 1: Extract Audio & Generate Web Preview Video
        s1_start = time.time()
        print(f"[{task_id}] Step 1: Extracting audio and generating web preview...")
        tasks[task_id] = {"step": 1, "status": "กำลังเตรียมไฟล์เสียงและตัวอย่างวิดีโอ...", "progress": 10}
        
        # 1.1 Extract Audio for Whisper
        subprocess.run([
            "ffmpeg", "-i", input_video_path, "-ac", "1", "-ar", "16000", audio_path, "-y"
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        # 1.2 Generate standard highly-compatible web preview (H.264 + AAC)
        # This solves missing audio / format issues in browsers for formats like .mov with PCM audio
        preview_video_path = os.path.join(session_dir, "preview.mp4")
        try:
            print(f"[{task_id}] Step 1.2: Generating web preview.mp4...")
            subprocess.run([
                "ffmpeg", "-i", input_video_path,
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
                "-c:a", "aac", "-b:a", "128k", "-ac", "2",
                preview_video_path, "-y"
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            print(f"[{task_id}] Web preview generated successfully.")
        except Exception as e:
            print(f"[{task_id}] Failed to pre-generate web preview: {e}")
            
        s1_dur = time.time() - s1_start
        print(f"[{task_id}] Step 1 OK ({s1_dur:.2f}s)")

        # Step 2: Transcribe
        s2_start = time.time()
        print(f"[{task_id}] Step 2: Transcribing with Whisper...")
        tasks[task_id] = {"step": 2, "status": "กำลังถอดเสียงด้วยความแม่นยำสูง...", "progress": 30, "step_time": f"{s1_dur:.1f}s"}
        
        prompt = f"วิดีโอนี้เกี่ยวกับ: {custom_vocab}. ภาษาไทยที่เป็นธรรมชาติ"
        
        segments_gen, info = whisper_model.transcribe(
            audio_path, 
            language="th", 
            beam_size=5,
            best_of=5,
            patience=2.0,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=400), # OPTIMIZATION 1: slightly more sensitive silences
            initial_prompt=prompt, 
            condition_on_previous_text=True,
            repetition_penalty=1.2,
            no_repeat_ngram_size=3,
            suppress_blank=True,
            temperature=[0.0, 0.2, 0.4, 0.6]
        )
        
        raw_segments = list(segments_gen)
        s2_dur = time.time() - s2_start
        print(f"[{task_id}] Step 2 OK ({s2_dur:.2f}s). Found {len(raw_segments)} segments.")

        # Step 3: Grouping
        s3_start = time.time()
        print(f"[{task_id}] Step 3: Grouping Thai words...")
        tasks[task_id] = {"step": 3, "status": "กำลังจัดกลุ่มคำและเกลาด้วย AI...", "progress": 60, "step_time": f"{s2_dur:.1f}s"}
        
        raw_subs = []
        texts_to_refine = []
        
        for s in raw_segments:
            if not s.words: continue
            segment_tokens = [{"start": w.start, "end": w.end, "word": w.word.strip()} for w in s.words]
            segment_words = group_thai_words(segment_tokens)
            if not segment_words: continue

            for i in range(0, len(segment_words), 5):
                chunk = segment_words[i : i + 5]
                combined_text = "".join([w["word"] for w in chunk])
                normalized_text = normalize_thai_text(combined_text)
                raw_subs.append({
                    "index": len(raw_subs) + 1,
                    "start": chunk[0]["start"],
                    "end": chunk[-1]["end"],
                    "content": normalized_text,
                    "words": chunk,
                    "segment_id": getattr(s, 'id', len(raw_subs))
                })
                texts_to_refine.append(normalized_text)
        
        s3_dur = time.time() - s3_start
        print(f"[{task_id}] Step 3 OK ({s3_dur:.2f}s)")

        # Step 4: LLM Refinement
        s4_dur = 0
        if use_llm and texts_to_refine:
            s4_start = time.time()
            print(f"[{task_id}] Step 4: AI Refinement (LM Studio)...")
            tasks[task_id] = {"status": "กำลังเกลาคำด้วย AI (LM Studio)..."}
            refined_texts = batch_refine_text(texts_to_refine)
            for idx, refined in enumerate(refined_texts):
                if idx < len(raw_subs):
                    raw_subs[idx]["content"] = refined
            s4_dur = time.time() - s4_start
            print(f"[{task_id}] Step 4 OK ({s4_dur:.2f}s)")

        total_dur = time.time() - start_total
        print(f"[{task_id}] Task Preparation Finished. Total time: {total_dur:.2f}s")

        # Step 5: Ready
        tasks[task_id] = {
            "step": 4, 
            "status": "พร้อมแล้ว! ปรับแต่งสไตล์ TikTok ได้เลย", 
            "progress": 80,
            "waiting_for_user": True,
            "raw_subtitles": raw_subs,
            "step_time": f"{s4_dur:.1f}s" if use_llm else f"{s3_dur:.1f}s"
        }

    except Exception as e:
        print(f"[{task_id}] CRITICAL ERROR in prepare: {e}")
        tasks[task_id] = {"step": -1, "status": f"ข้อผิดพลาด: {str(e)}", "progress": 0}

def render_video_task(task_id: str, input_video_path: str, session_dir: str, settings: dict):
    """Core video burn rendering task using advanced ASS styles."""
    try:
        ass_path = os.path.join(session_dir, "subtitles.ass")
        output_video_path = os.path.join(session_dir, "output.mp4")
        
        tasks[task_id] = {"step": 5, "status": "กำลังเตรียมสไตล์และวิดีโอ...", "progress": 85, "waiting_for_user": False}

        primary_ass = hex_to_ass_color(settings.get("primary_color", "#FFFFFF"), "00")
        outline_ass = hex_to_ass_color(settings.get("outline_color", "#000000"), "00")
        
        # Colors for inline tags (Karaoke)
        primary_tag = hex_to_ass_tag_color(settings.get("primary_color", "#FFFFFF"))
        highlight_tag = hex_to_ass_tag_color(settings.get("highlight_color", "#FFFF00"))
        
        bg_style = settings.get("bg_style", "outline")
        # ASS transparency: &H00 is opaque, &HFF is transparent.
        # For box/shadow/glow, we set backing color transparency accordingly
        back_colour = "&H80000000" if bg_style in ["box", "shadow"] else "&H00000000"
        
        # BorderStyle 1 = Outline + Shadow, 3 = Opaque Box
        border_style = 3 if bg_style == "box" else 1
        
        outline_size_setting = float(settings.get("outline_size", 2.0))
        outline_size = 0.0
        shadow_size = 0.0

        if bg_style == "outline":
            outline_size = outline_size_setting
            shadow_size = 0.0
        elif bg_style == "shadow":
            outline_size = 1.0 # Small base outline
            shadow_size = outline_size_setting
        elif bg_style == "box":
            outline_size = outline_size_setting # Acts as padding
            shadow_size = 0.0
        elif bg_style == "glow":
            # Glow uses a wider outline blur
            outline_size = outline_size_setting + 2.0
            shadow_size = 0.0

        font_size = settings.get("font_size", 24)
        font_family = settings.get("font_family", "Arial")
        margin_v = settings.get("margin_v", 20)
        edited_subs = settings.get("subtitles") or []

        # 1. Probe video dimensions
        try:
            probe_cmd = ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", input_video_path]
            probe_result = subprocess.run(probe_cmd, capture_output=True, text=True, check=True).stdout.strip().split(',')
            video_width = int(probe_result[0])
            video_height = int(probe_result[1])
        except:
            video_width = 1280
            video_height = 720

        scale = video_height / 720.0
        scaled_font_size = int(font_size * scale)
        scaled_margin_v = int(margin_v * scale)
        scaled_outline_size = outline_size * scale
        scaled_shadow_size = shadow_size * scale
        
        # 2. Generate ASS Content
        def format_ass_time(seconds: float):
            td = datetime.timedelta(seconds=seconds)
            total_seconds = int(td.total_seconds())
            hours = total_seconds // 3600
            minutes = (total_seconds % 3600) // 60
            secs = total_seconds % 60
            ms = int(td.microseconds / 10000)
            return f"{hours}:{minutes:02}:{secs:02}.{ms:02}"

        # Headline settings
        headline_font_size = settings.get("headline_size", 36)
        headline_margin_v = settings.get("headline_v", 50)
        headline_font = settings.get("headline_font", font_family)
        headline_color = hex_to_ass_color(settings.get("headline_color", "#FFFFFF"), "00")
        headline_bg_color = hex_to_ass_color(settings.get("headline_bg_color", "#000000"), "33")
        headline_style = settings.get("headline_bg_style", "box")
        
        ass_headline_border = 3 if headline_style == "box" else 1
        ass_headline_outline = 3 if headline_style in ["box", "outline"] else 0
        
        ass_header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {video_width}
PlayResY: {video_height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_family},{scaled_font_size},{primary_ass},{primary_ass},{outline_ass},{back_colour},-1,0,0,0,100,100,0,0,{border_style},{scaled_outline_size},{scaled_shadow_size},2,10,10,{scaled_margin_v},1
Style: Headline,{headline_font},{int(headline_font_size * scale)},{headline_color},{headline_color},&H00000000,{headline_bg_color},-1,0,0,0,100,100,0,0,{ass_headline_border},{ass_headline_outline},0,8,10,10,{int(headline_margin_v * scale)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
        ass_events = []
        
        headline_text = settings.get("headline", "")
        if headline_text:
            try:
                dur_cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", input_video_path]
                duration = float(subprocess.run(dur_cmd, capture_output=True, text=True).stdout.strip())
                end_time = format_ass_time(duration)
                formatted_headline = headline_text.replace("\n", "\\N")
                ass_events.append(f"Dialogue: 1,0:00:00.00,{end_time},Headline,,0,0,0,,{formatted_headline}")
            except:
                pass

        anim_type = settings.get("animation_type", "none")
        
        for sub in edited_subs:
            start_str = format_ass_time(sub["start"])
            end_str = format_ass_time(sub["end"])
            
            content = sub["content"].replace("\n", "\\N")
            
            # Combine glow prefix with animation prefixes
            glow_tag = "\\blur3" if bg_style == "glow" else ""
            
            # Karaoke Highlight Logic
            if anim_type == "karaoke" and sub.get("words"):
                # Use tag-specific color format &HBBGGRR&
                prefix = f"{{\\1c{highlight_tag}\\2c{primary_tag}" + (f"\\{glow_tag}" if glow_tag else "") + "}"
                karaoke_content = ""
                
                # Calculate initial delay
                last_end = sub["start"]
                for w in sub["words"]:
                    # Wait/Silence duration
                    wait_dur = int(round((w["start"] - last_end) * 100))
                    if wait_dur > 0:
                        karaoke_content += f"{{\\k{wait_dur}}}"
                    
                    # Word duration
                    dur = int(round((w["end"] - w["start"]) * 100))
                    dur = max(1, dur)
                    karaoke_content += f"{{\\k{dur}}}{w['word']}"
                    last_end = w["end"]
                
                joined_words = "".join([w['word'] for w in sub["words"]]).strip()
                if sub["content"].strip() == joined_words:
                    content = karaoke_content
                else:
                    prefix = f"{{\\1c{highlight_tag}" + (f"\\{glow_tag}" if glow_tag else "") + "}"
            else:
                anim_tag = ""
                if anim_type == "fade":
                    anim_tag = "\\fad(200,200)"
                elif anim_type == "pop":
                    anim_tag = "\\fscx80\\fscy80\\t(0,150,\\fscx105\\fscy105)\\t(0,300,\\fscx100\\fscy100)"
                elif anim_type == "bounce":
                    # Elastic bounce animation (Upgrade 3)
                    anim_tag = "\\fscx80\\fscy80\\t(0,120,\\fscx115\\fscy115)\\t(120,220,\\fscx95\\fscy95)\\t(220,320,\\fscx100\\fscy100)"
                
                combined_tags = []
                if glow_tag: combined_tags.append(glow_tag)
                if anim_tag: combined_tags.append(anim_tag)
                
                prefix = f"{{{str(''.join(combined_tags))}}}" if combined_tags else ""
                
            ass_events.append(f"Dialogue: 0,{start_str},{end_str},Default,,0,0,0,,{prefix}{content}")
        
        with open(ass_path, "w", encoding="utf-8") as f:
            f.write(ass_header + "\n".join(ass_events))

        tasks[task_id] = {"step": 5, "status": "กำลังเริ่มฝังซับลงในวิดีโอ (ASS)...", "progress": 90}

        # 3. Render with ASS filter
        abs_fonts_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "fonts")).replace('\\', '/')
        escaped_fonts_dir = abs_fonts_dir.replace(':', '\\:')
        
        rel_input = os.path.basename(input_video_path)
        rel_output = "output.mp4"
        rel_ass = "subtitles.ass"
        
        vf_filter = f"ass='{rel_ass}':fontsdir='{escaped_fonts_dir}'"

        cmd_cuda = [
            "ffmpeg", "-hwaccel", "cuda", "-i", rel_input,
            "-vf", vf_filter,
            "-c:v", "h264_nvenc", "-preset", "p2", "-cq", "26", "-c:a", "copy",
            rel_output, "-y"
        ]
        
        cmd_cpu = [
            "ffmpeg", "-i", rel_input,
            "-vf", vf_filter,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "copy",
            rel_output, "-y"
        ]

        print(f"[RENDER] Filter: {vf_filter}")
        result = subprocess.run(cmd_cuda, capture_output=True, text=True, cwd=session_dir)
        if result.returncode != 0:
            print(f"[RENDER] CUDA Failed, trying CPU. Error: {result.stderr}")
            result = subprocess.run(cmd_cpu, capture_output=True, text=True, cwd=session_dir)
            if result.returncode != 0:
                print(f"[RENDER] CPU Failed. Error: {result.stderr}")
                raise Exception(f"FFmpeg failed: {result.stderr}")

        print("[RENDER] Success!")
        tasks[task_id] = {
            "step": 6, 
            "status": "เสร็จสิ้น!", 
            "progress": 100, 
            "result_url": f"/api/download/{task_id}",
            "waiting_for_user": False
        }
    except Exception as e:
        print(f"[RENDER] Error in render: {str(e)}")
        tasks[task_id] = {"step": -1, "status": f"Error: {str(e)}", "progress": 0}

def queue_worker():
    print("[QUEUE] Background queue worker thread started.")
    while True:
        try:
            item = task_queue.get()
            if item is None:
                break
            
            task_type, task_args = item
            task_id = task_args[0]
            print(f"[QUEUE] Processing task {task_id} ({task_type})")
            
            if task_type == "prepare":
                prepare_video_task(*task_args)
            elif task_type == "render":
                render_video_task(*task_args)
                
            task_queue.task_done()
        except Exception as e:
            print(f"[QUEUE ERROR] Exception in background worker: {e}")
        time.sleep(0.5)

# Start Queue Worker Thread
worker_thread = threading.Thread(target=queue_worker, daemon=True)
worker_thread.start()

# ----------------- AUTO-CLEANUP SCHEDULER -----------------
def auto_cleanup_loop():
    print("[CLEANUP] Background cleanup thread started.")
    while True:
        try:
            now = time.time()
            if os.path.exists(UPLOAD_DIR):
                for folder in os.listdir(UPLOAD_DIR):
                    folder_path = os.path.join(UPLOAD_DIR, folder)
                    if os.path.isdir(folder_path):
                        mtime = os.path.getmtime(folder_path)
                        # Deletes directories older than 24 hours (86400 seconds)
                        if now - mtime > 86400:
                            print(f"[CLEANUP] Deleting expired upload folder: {folder_path}")
                            shutil.rmtree(folder_path, ignore_errors=True)
        except Exception as e:
            print(f"[CLEANUP ERROR] Failed in cleanup cycle: {e}")
        # Run cleanup every hour
        time.sleep(3600)

cleanup_thread = threading.Thread(target=auto_cleanup_loop, daemon=True)
cleanup_thread.start()

# ----------------- AUXILIARY UTILITIES -----------------

def normalize_thai_text(text: str) -> str:
    """Normalize Thai text: orthography, numbers, spacing."""
    if not text:
        return text
    text = normalize(text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def format_timestamp(seconds: float) -> str:
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"

def split_long_subtitle(text: str, max_chars: int = 25) -> list:
    if len(text) <= max_chars:
        return [text]
    tokens = word_tokenize(text, engine='newmm')
    lines = []
    current_line = []
    current_len = 0
    for token in tokens:
        if current_len + len(token) > max_chars and current_line:
            lines.append(''.join(current_line))
            current_line = [token]
            current_len = len(token)
        else:
            current_line.append(token)
            current_len += len(token)
    if current_line:
        lines.append(''.join(current_line))
    return lines[:2]

def batch_refine_text(texts: list) -> list:
    if not texts:
        return []
    prompt_input = "\n".join([f"{i+1}. {t}" for i, t in enumerate(texts)])
    try:
        response = lm_client.chat.completions.create(
            model="local-model",
            messages=[
                {"role": "system", "content": "You are a professional Thai subtitle proofreader. Correct spelling and grammar errors for the following numbered list. Keep English words intact. Maintain the exact same numbering and number of lines. Output ONLY the corrected list."},
                {"role": "user", "content": prompt_input}
            ],
            temperature=0.2,
            max_tokens=2048,
        )
        result = response.choices[0].message.content.strip()
        refined_lines = []
        for line in result.split('\n'):
            cleaned = re.sub(r'^\d+\.\s*', '', line).strip()
            if cleaned:
                refined_lines.append(cleaned)
        if len(refined_lines) < len(texts):
            print(f"[WARN] LLM returned fewer lines ({len(refined_lines)}) than input ({len(texts)}). Padding with original texts.")
            while len(refined_lines) < len(texts):
                refined_lines.append(texts[len(refined_lines)])
        return refined_lines[:len(texts)]
    except Exception as e:
        print(f"Batch LLM refinement failed: {e}")
        return texts

def group_thai_words(tokens: list) -> list:
    if not tokens:
        return []
    full_text = "".join([t["word"] for t in tokens])
    real_words = word_tokenize(full_text, engine='newmm')
    grouped = []
    char_map = []
    for t_idx, t in enumerate(tokens):
        for c in t["word"]:
            char_map.append({
                "char": c,
                "start": t["start"],
                "end": t["end"]
            })
    char_idx = 0
    for word in real_words:
        word = word.strip()
        if not word: continue
        word_start = char_map[char_idx]["start"] if char_idx < len(char_map) else tokens[-1]["start"]
        for _ in range(len(word)):
            if char_idx < len(char_map):
                char_idx += 1
        word_end = char_map[char_idx-1]["end"] if char_idx-1 < len(char_map) else tokens[-1]["end"]
        grouped.append({
            "start": word_start,
            "end": word_end,
            "word": word
        })
    return grouped

def hex_to_ass_color(hex_color: str, alpha: str = "00"):
    hex_color = hex_color.lstrip('#')
    if len(hex_color) == 6:
        r, g, b = hex_color[0:2], hex_color[2:4], hex_color[4:6]
        return f"&H{alpha}{b}{g}{r}"
    return f"&H{alpha}FFFFFF"

def hex_to_ass_tag_color(hex_color: str):
    hex_color = hex_color.lstrip('#')
    if len(hex_color) == 6:
        r, g, b = hex_color[0:2], hex_color[2:4], hex_color[4:6]
        return f"&H{b}{g}{r}&"
    return "&HFFFFFF&"

# ----------------- FASTAPI API ENDPOINTS -----------------

@app.post("/api/upload")
async def upload_video(file: UploadFile = File(...), use_llm: str = Form("true"), custom_vocab: str = Form("")):
    filename = file.filename or ""
    if not filename.lower().endswith(('.mp4', '.mov', '.avi', '.mkv', '.webm')):
        raise HTTPException(status_code=400, detail="ไฟล์ไม่รองรับ. กรุณาใช้ .mp4, .mov, .avi, .mkv หรือ .webm")
    
    task_id = str(uuid.uuid4())
    session_dir = os.path.join(UPLOAD_DIR, task_id)
    os.makedirs(session_dir, exist_ok=True)
    
    input_video_path = os.path.join(session_dir, f"input_{file.filename}")
    with open(input_video_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    is_use_llm = use_llm.lower() == "true"
    # Push into permanent SQLite DB through Transparent proxy dictionary
    tasks[task_id] = {
        "step": 0, 
        "status": "อัปโหลดเสร็จสิ้น อยู่ในคิวรอประมวลผล...", 
        "progress": 0, 
        "waiting_for_user": False
    }
    
    # Enqueue tasks in Background thread pool for sequential execution
    task_queue.put(("prepare", (task_id, input_video_path, session_dir, is_use_llm, custom_vocab)))
    return {"task_id": task_id}

class SubtitleItem(BaseModel):
    index: int
    start: float
    end: float
    content: str
    words: Optional[List[dict]] = None

class RenderSettings(BaseModel):
    font_size: float = 24
    primary_color: str = "#FFFFFF"
    outline_color: str = "#000000"
    highlight_color: str = "#FFFF00"
    font_family: str = "Arial"
    margin_v: float = 20
    bg_style: str = "outline" # "outline", "shadow", "box", "glow"
    animation_type: str = "none" # "none", "fade", "pop", "bounce", "karaoke"
    max_words: int = 5
    outline_size: float = 2
    headline: Optional[str] = ""
    headline_size: float = 36
    headline_v: float = 50
    headline_font: Optional[str] = "Arial"
    headline_color: Optional[str] = "#FFFFFF"
    headline_bg_color: Optional[str] = "#000000"
    headline_bg_style: Optional[str] = "box" # "none", "box", "outline"
    headline_outline_size: float = 3
    subtitles: Optional[List[SubtitleItem]] = None

@app.post("/api/render/{task_id}")
async def start_render(task_id: str, settings: RenderSettings):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="ไม่พบงานนี้")
        
    session_dir = os.path.join(UPLOAD_DIR, task_id)
    input_video_path = None
    for f in os.listdir(session_dir):
        if f.startswith("input_"):
            input_video_path = os.path.join(session_dir, f)
            break
            
    if not input_video_path:
        raise HTTPException(status_code=404, detail="ไม่พบไฟล์วิดีโอต้นฉบับ")
        
    # Queue render task
    tasks[task_id] = {"step": 5, "status": "กำลังเริ่ม render...", "progress": 85, "waiting_for_user": False}
    task_queue.put(("render", (task_id, input_video_path, session_dir, settings.dict())))
    return {"status": "เริ่ม render"}

@app.get("/api/status/{task_id}")
async def get_status(task_id: str):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="ไม่พบงานนี้")
    return tasks[task_id]

@app.get("/api/subtitles/{task_id}")
async def get_subtitles(task_id: str):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="ไม่พบงานนี้")
    
    task_data = tasks[task_id]
    if "raw_subtitles" in task_data and task_data["raw_subtitles"]:
        return task_data["raw_subtitles"]
        
    session_dir = os.path.join(UPLOAD_DIR, task_id)
    srt_path = os.path.join(session_dir, "subtitles.srt")
    if not os.path.exists(srt_path):
        return []
        
    with open(srt_path, "r", encoding="utf-8") as f:
        srt_content = f.read()
        
    subs = list(srt.parse(srt_content))
    return [
        {
            "index": sub.index,
            "start": sub.start.total_seconds(),
            "end": sub.end.total_seconds(),
            "content": sub.content
        } for sub in subs
    ]

def range_compatible_response(file_path: str, media_type: str, request: Request):
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="ไฟล์ไม่มีอยู่")
        
    file_size = os.path.getsize(file_path)
    range_header = request.headers.get("range")
    
    if not range_header:
        def full_file_iterator():
            with open(file_path, "rb") as f:
                while chunk := f.read(8192 * 16):
                    yield chunk
        return StreamingResponse(
            full_file_iterator(),
            media_type=media_type,
            headers={
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size)
            }
        )

    try:
        range_str = range_header.replace("bytes=", "")
        start_str, end_str = range_str.split("-")
        if not start_str and end_str:
            end = file_size - 1
            start = max(0, file_size - int(end_str))
        else:
            start = int(start_str) if start_str else 0
            end = int(end_str) if end_str else file_size - 1
    except Exception:
        raise HTTPException(status_code=400, detail="รูปแบบ Range header ไม่ถูกต้อง")
        
    if start >= file_size or end >= file_size or start > end:
        raise HTTPException(
            status_code=416,
            detail=f"ช่วง byte ที่ขอไม่ถูกต้อง: {start}-{end}/{file_size}",
            headers={"Content-Range": f"bytes */{file_size}"}
        )
        
    chunk_size = end - start + 1
    
    def file_chunk_iterator(path: str, offset: int, limit: int):
        bytes_to_read = limit
        with open(path, "rb") as f:
            f.seek(offset)
            while bytes_to_read > 0:
                chunk_to_read = min(8192 * 16, bytes_to_read)
                data = f.read(chunk_to_read)
                if not data:
                    break
                yield data
                bytes_to_read -= len(data)
                
    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(chunk_size),
        "Content-Type": media_type,
    }
    
    return StreamingResponse(
        file_chunk_iterator(file_path, start, chunk_size),
        status_code=status.HTTP_206_PARTIAL_CONTENT,
        headers=headers
    )

@app.get("/api/download/{task_id}")
async def download_video(task_id: str, request: Request):
    session_dir = os.path.join(UPLOAD_DIR, task_id)
    output_video_path = os.path.join(session_dir, "output.mp4")
    
    if not os.path.exists(output_video_path):
        raise HTTPException(status_code=404, detail="ไฟล์ยังไม่พร้อมหรือไม่มีอยู่")
        
    # Return range-compatible response so it can be streamed and seeked in client player
    return range_compatible_response(output_video_path, "video/mp4", request)

@app.get("/api/video/{task_id}")
async def get_original_video(task_id: str, request: Request):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="ไม่พบงานนี้")
    
    session_dir = os.path.abspath(os.path.join(UPLOAD_DIR, task_id))
    if not os.path.exists(session_dir):
        raise HTTPException(status_code=404, detail="ไม่พบโฟลเดอร์งาน")

    # 1. Try to serve a web-friendly preview (H.264 + AAC) for maximum compatibility.
    # If the user uploaded a file like .mov (iPhone PCM audio) or high bitrate, the browser
    # won't play audio or will lag. Web preview fixes it.
    preview_video_path = os.path.join(session_dir, "preview.mp4")
    if not os.path.exists(preview_video_path):
        # Generate on-the-fly to fix existing uploaded tasks!
        input_video_path = None
        for f in os.listdir(session_dir):
            if f.startswith("input_"):
                input_video_path = os.path.join(session_dir, f)
                break
                
        if input_video_path and os.path.exists(input_video_path):
            print(f"[ON-THE-FLY PREVIEW] Generating web preview for existing upload: {input_video_path}")
            try:
                subprocess.run([
                    "ffmpeg", "-i", input_video_path,
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
                    "-c:a", "aac", "-b:a", "128k", "-ac", "2",
                    preview_video_path, "-y"
                ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                print("[ON-THE-FLY PREVIEW] Success!")
            except Exception as e:
                print(f"[ON-THE-FLY PREVIEW] Failed to generate: {e}")

    if os.path.exists(preview_video_path):
        return range_compatible_response(preview_video_path, "video/mp4", request)

    # 2. Fallback to original input file if preview couldn't be generated
    input_video_path = None
    for f in os.listdir(session_dir):
        if f.startswith("input_"):
            input_video_path = os.path.join(session_dir, f)
            break
            
    if not input_video_path or not os.path.exists(input_video_path):
        raise HTTPException(status_code=404, detail="ไม่พบไฟล์วิดีโอต้นฉบับ")
    
    file_ext = os.path.splitext(input_video_path)[1].lower()
    media_type_map = {
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.mkv': 'video/x-matroska',
        '.webm': 'video/webm',
        '.flv': 'video/x-flv',
        '.wmv': 'video/x-ms-wmv'
    }
    media_type = media_type_map.get(file_ext, 'video/mp4')
        
    return range_compatible_response(input_video_path, media_type, request)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)