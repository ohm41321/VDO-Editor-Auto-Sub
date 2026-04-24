import os
import sys
import site

# Environment fixes for Windows
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
os.environ["HF_HUB_OFFLINE"] = "0"

def add_cuda_dlls():
    if os.name != "nt": return
    # Hardcode the venv site-packages path to ensure Uvicorn subprocess finds it
    base_dir = os.path.dirname(os.path.abspath(__file__))
    sp = os.path.join(base_dir, "venv", "Lib", "site-packages")
    
    cublas_path = os.path.join(sp, "nvidia", "cublas", "bin")
    cudnn_path = os.path.join(sp, "nvidia", "cudnn", "bin")
    cudart_path = os.path.join(sp, "nvidia", "cuda_runtime", "bin")
    for p in (cublas_path, cudnn_path, cudart_path):
        if os.path.exists(p):
            try:
                os.add_dll_directory(p)
                print(f"[DEBUG] Successfully added CUDA DLL path: {p}")
            except Exception as e:
                print(f"[DEBUG] Failed to add CUDA DLL path {p}: {e}")
            os.environ["PATH"] = p + os.pathsep + os.environ.get("PATH", "")

add_cuda_dlls()

import shutil
import uuid
import subprocess
import asyncio
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
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

app = FastAPI(title="Auto Thai Subtitler")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1. OPTIMIZATION: High Speed with Smart Prompting
MODEL_SIZE = "large-v3-turbo" 

try:
    print(f"Loading Whisper model '{MODEL_SIZE}' on GPU...")
    # Using float16 for maximum speed
    whisper_model = WhisperModel(MODEL_SIZE, device="cuda", compute_type="float16")
    print("[OK] Whisper model loaded!")
except Exception as e:
    print(f"[WARN] CPU Fallback...")
    whisper_model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")

lm_client = OpenAI(base_url="http://localhost:1234/v1", api_key="lm-studio")

UPLOAD_DIR = "temp_uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

tasks = {}

def normalize_thai_text(text: str) -> str:
    """Normalize Thai text: fix spacing, numbers, politeness particles, repetition markers."""
    if not text:
        return text
    
    # 1. PyThaiNLP normalization
    text = normalize(text)
    
    # 2. Basic cleanup
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def format_timestamp(seconds: float) -> str:
    """Convert seconds to SRT timestamp format HH:MM:SS,mmm."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"

def split_long_subtitle(text: str, max_chars: int = 25) -> list:
    """
    Split Thai subtitle into multiple lines for readability (Max 25 for safety).
    """
    if len(text) <= max_chars:
        return [text]
    
    # Tokenize using PyThaiNLP to find phrase boundaries
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
    
    return lines[:2]  # Max 2 lines per subtitle

def batch_refine_text(texts: list) -> list:
    """Refine multiple Thai text segments in a single LLM call for speed."""
    if not texts:
        return []
    
    # Format segments into a numbered list for the LLM
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
        
        # Parse the result back into a list
        refined_lines = []
        for line in result.split('\n'):
            # Remove the "1. " numbering prefix
            cleaned = re.sub(r'^\d+\.\s*', '', line).strip()
            if cleaned:
                refined_lines.append(cleaned)
        
        # Fallback if LLM output is shorter than input
        if len(refined_lines) < len(texts):
            print(f"[WARN] LLM returned fewer lines ({len(refined_lines)}) than input ({len(texts)}). Padding with original texts.")
            while len(refined_lines) < len(texts):
                refined_lines.append(texts[len(refined_lines)])
        
        return refined_lines[:len(texts)]
    except Exception as e:
        print(f"Batch LLM refinement failed: {e}")
        return texts

def group_thai_words(tokens: list) -> list:
    """Group character/syllable tokens into actual Thai words using PyThaiNLP."""
    if not tokens:
        return []
        
    full_text = "".join([t["word"] for t in tokens])
    # Use PyThaiNLP to find actual word boundaries
    real_words = word_tokenize(full_text, engine='newmm')
    
    grouped = []
    token_idx = 0
    
    for word in real_words:
        if token_idx >= len(tokens):
            break
            
        word_start = tokens[token_idx]["start"]
        word_end = tokens[token_idx]["end"]
        
        # Accumulate tokens until they match the 'real_word'
        current_match = ""
        while token_idx < len(tokens) and len(current_match) < len(word):
            current_match += tokens[token_idx]["word"]
            word_end = tokens[token_idx]["end"]
            token_idx += 1
            
        grouped.append({
            "start": word_start,
            "end": word_end,
            "word": word
        })
    return grouped

def prepare_video_task(task_id: str, input_video_path: str, session_dir: str, use_llm: bool = True, custom_vocab: str = ""):
    """Background task to extract audio and transcribe with word-level precision."""
    try:
        audio_path = os.path.join(session_dir, "audio.wav")
        srt_path = os.path.join(session_dir, "subtitles.srt")

        # Step 1: Extract Audio (Fast)
        tasks[task_id] = {"step": 1, "status": "กำลังแยกเสียงจากวิดีโอ...", "progress": 10}
        subprocess.run([
            "ffmpeg", "-i", input_video_path, "-q:a", "0", "-map", "a", audio_path, "-y"
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        # Step 2: Transcribe with Word Timestamps
        tasks[task_id] = {"step": 2, "status": "กำลังถอดเสียงระดับคำ (Word-level AI)...", "progress": 30}
        
        segments_gen, info = whisper_model.transcribe(
            audio_path, 
            language="th", 
            beam_size=5,
            word_timestamps=True,
            vad_filter=True,
            initial_prompt="สวัสดีครับ วันนี้เราจะมาพูดถึงเรื่องราวที่น่าสนใจในวิดีโอนี้กันนะครับ", 
            condition_on_previous_text=True
        )
        
        # Step 3: Group words WITHIN their original segments
        tasks[task_id] = {"step": 3, "status": "กำลังจัดกลุ่มคำให้กระชับ (Punchy Style)...", "progress": 60}
        
        raw_subs = []
        for s in segments_gen:
            if not s.words: continue
            
            # Group tokens into real Thai words for THIS segment only
            segment_tokens = [{"start": w.start, "end": w.end, "word": w.word.strip()} for w in s.words]
            segment_words = group_thai_words(segment_tokens)
            
            if not segment_words: continue

            # Default grouping: 5 words per chunk within this segment
            for i in range(0, len(segment_words), 5):
                chunk = segment_words[i : i + 5]
                combined_text = "".join([w["word"] for w in chunk])
                
                raw_subs.append({
                    "index": len(raw_subs) + 1,
                    "start": chunk[0]["start"],
                    "end": chunk[-1]["end"],
                    "content": normalize_thai_text(combined_text),
                    "words": chunk,
                    "segment_id": getattr(s, 'id', len(raw_subs)) # Keep track of original segment
                })

        tasks[task_id] = {
            "step": 4, 
            "status": "พร้อมแล้ว! ปรับแต่งสไตล์ TikTok ได้เลย", 
            "progress": 80,
            "waiting_for_user": True,
            "raw_subtitles": raw_subs
        }

    except Exception as e:
        print(f"Error preparing task {task_id}: {e}")
        tasks[task_id] = {"step": -1, "status": f"ข้อผิดพลาด: {str(e)}", "progress": 0}

def hex_to_ass_color(hex_color: str, alpha: str = "00"):
    """Convert #RRGGBB to &H{alpha}BBGGRR for ASS format."""
    hex_color = hex_color.lstrip('#')
    if len(hex_color) == 6:
        r, g, b = hex_color[0:2], hex_color[2:4], hex_color[4:6]
        return f"&H{alpha}{b}{g}{r}"
    return f"&H{alpha}FFFFFF"

def render_video_task(task_id: str, input_video_path: str, session_dir: str, settings: dict):
    """Background task with robust ASS-based subtitle burning."""
    try:
        ass_path = os.path.join(session_dir, "subtitles.ass")
        output_video_path = os.path.join(session_dir, "output.mp4")
        
        tasks[task_id] = {"step": 5, "status": "กำลังเตรียมสไตล์และวิดีโอ...", "progress": 85, "waiting_for_user": False}

        primary_ass = hex_to_ass_color(settings.get("primary_color", "#FFFFFF"), "00")
        outline_ass = hex_to_ass_color(settings.get("outline_color", "#000000"), "00")
        highlight_ass = hex_to_ass_color(settings.get("highlight_color", "#FFFF00"), "00")
        
        bg_style = settings.get("bg_style", "outline")
        # ASS transparency: &H00 is opaque, &HFF is transparent.
        # For box/shadow, we use semi-transparent black (&H80000000)
        back_colour = "&H80000000" if bg_style in ["box", "shadow"] else "&H00000000"
        
        # BorderStyle 1 = Outline + Shadow, 3 = Opaque Box
        border_style = 3 if bg_style == "box" else 1
        
        # In BorderStyle 3 (Box), 'Outline' acts as the box padding/size.
        if bg_style == "box":
            outline_size = 2.0
            shadow_size = 0.0
        elif bg_style == "shadow":
            outline_size = 1.0 # Small outline for better contrast
            shadow_size = 2.0
        else: # outline
            outline_size = 2.0
            shadow_size = 0.0

        font_size = settings.get("font_size", 24)
        font_family = settings.get("font_family", "Arial")
        margin_v = settings.get("margin_v", 20)
        edited_subs = settings.get("subtitles") or []

        # 1. Probe video width and height for perfect vertical/horizontal scaling
        try:
            probe_cmd = ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", input_video_path]
            probe_result = subprocess.run(probe_cmd, capture_output=True, text=True, check=True).stdout.strip().split(',')
            video_width = int(probe_result[0])
            video_height = int(probe_result[1])
        except:
            video_width = 1280
            video_height = 720

        # We assume the frontend edits are based on a 720p Y-coordinate space
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
        headline_bg_color = hex_to_ass_color(settings.get("headline_bg_color", "#000000"), "33") # 80% opaque
        headline_style = settings.get("headline_bg_style", "box")
        
        # ASS BorderStyle: 1=Outline+Shadow, 3=Opaque Box
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
        
        # Add persistent Headline if provided
        headline = settings.get("headline", "")
        if headline:
            # We need to find video duration to make it persistent
            try:
                dur_cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", input_video_path]
                duration = float(subprocess.run(dur_cmd, capture_output=True, text=True).stdout.strip())
                end_time = format_ass_time(duration)
                # Support multi-line in ASS using \N
                formatted_headline = headline.replace("\n", "\\N")
                ass_events.append(f"Dialogue: 1,0:00:00.00,{end_time},Headline,,0,0,0,,{formatted_headline}")
            except:
                pass

        anim_type = settings.get("animation_type", "none")
        
        for sub in edited_subs:
            start = format_ass_time(sub["start"])
            end = format_ass_time(sub["end"])
            
            content = sub["content"].replace("\n", "\\N")
            prefix = ""
            
            # Karaoke Highlight Logic
            if anim_type == "karaoke" and sub.get("words"):
                # Override colors for this line: 1c (Active/Primary) and 2c (Idle/Secondary)
                prefix = f"{{\\1c{highlight_ass}\\2c{primary_ass}}}"
                karaoke_content = ""
                for w in sub["words"]:
                    dur = int(round((w["end"] - w["start"]) * 100))
                    dur = max(1, dur)
                    karaoke_content += f"{{\\k{dur}}}{w['word']}"
                content = karaoke_content
            elif anim_type == "fade":
                prefix = "{\\fad(200,200)}"
            elif anim_type == "pop":
                prefix = "{\\fscx80\\fscy80\\t(0,150,\\fscx105\\fscy105)\\t(150,300,\\fscx100\\fscy100)}"
                
            ass_events.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{prefix}{content}")
        
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
        print(f"[RENDER] Error: {str(e)}")
        tasks[task_id] = {"step": -1, "status": f"Error: {str(e)}", "progress": 0}

@app.post("/api/upload")
async def upload_video(background_tasks: BackgroundTasks, file: UploadFile = File(...), use_llm: str = Form("true"), custom_vocab: str = Form("")):
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
    tasks[task_id] = {"step": 0, "status": "อัปโหลดเสร็จสิ้น กำลังเริ่มประมวลผล...", "progress": 0, "waiting_for_user": False}
    background_tasks.add_task(prepare_video_task, task_id, input_video_path, session_dir, is_use_llm, custom_vocab)
    return {"task_id": task_id}

class SubtitleItem(BaseModel):
    index: int
    start: float
    end: float
    content: str
    words: Optional[List[dict]] = None

class RenderSettings(BaseModel):
    font_size: int = 24
    primary_color: str = "#FFFFFF"
    outline_color: str = "#000000"
    highlight_color: str = "#FFFF00"
    font_family: str = "Arial"
    margin_v: int = 20
    bg_style: str = "outline"
    animation_type: str = "none" # "none", "fade", "pop", "karaoke"
    max_words: int = 5
    headline: Optional[str] = ""
    headline_size: int = 36
    headline_v: int = 50
    headline_font: Optional[str] = "Arial"
    headline_color: Optional[str] = "#FFFFFF"
    headline_bg_color: Optional[str] = "#000000"
    headline_bg_style: Optional[str] = "box" # "none", "box", "outline"
    headline_outline_size: int = 3
    subtitles: Optional[List[SubtitleItem]] = None

@app.post("/api/render/{task_id}")
async def start_render(task_id: str, settings: RenderSettings, background_tasks: BackgroundTasks):
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
        
    tasks[task_id] = {"step": 5, "status": "กำลังเริ่ม render...", "progress": 85, "waiting_for_user": False}
    background_tasks.add_task(render_video_task, task_id, input_video_path, session_dir, settings.dict())
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
    
    # Prefer raw_subtitles (word-level precision) if available
    if "raw_subtitles" in tasks[task_id]:
        return tasks[task_id]["raw_subtitles"]
        
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

@app.get("/api/download/{task_id}")
async def download_video(task_id: str):
    session_dir = os.path.join(UPLOAD_DIR, task_id)
    output_video_path = os.path.join(session_dir, "output.mp4")
    
    if not os.path.exists(output_video_path):
        raise HTTPException(status_code=404, detail="ไฟล์ยังไม่พร้อมหรือไม่มีอยู่")
        
    return FileResponse(
        path=output_video_path,
        filename="video_has_subtitle.mp4",
        media_type="video/mp4"
    )

@app.get("/api/video/{task_id}")
async def get_original_video(task_id: str):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="ไม่พบงานนี้")
    
    session_dir = os.path.abspath(os.path.join(UPLOAD_DIR, task_id))
    input_video_path = None
    
    if not os.path.exists(session_dir):
        raise HTTPException(status_code=404, detail="ไม่พบโฟลเดอร์งาน")

    for f in os.listdir(session_dir):
        if f.startswith("input_"):
            input_video_path = os.path.join(session_dir, f)
            break
            
    if not input_video_path or not os.path.exists(input_video_path):
        raise HTTPException(status_code=404, detail="ไม่พบไฟล์วิดีโอต้นฉบับ")
    
    # Detect media type from file extension
    import mimetypes
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
        
    # FileResponse automatically handles Range requests if path is absolute and media_type is set
    return FileResponse(
        input_video_path, 
        media_type=media_type,
        headers={"Accept-Ranges": "bytes"}
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)