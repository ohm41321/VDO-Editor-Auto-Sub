# 🏗️ VDO Editor Lucia - Architecture & Features

เอกสารนี้รวบรวมข้อมูล Tech Stack, โครงสร้างการทำงาน และฟีเจอร์ทั้งหมดของโปรเจกต์ เพื่อใช้เป็นคู่มือในการทำความเข้าใจโค้ดและพัฒนาต่อในอนาคต

---

## 🛠️ Tech Stack

### Frontend
- **Framework:** Next.js 15+ (App Router)
- **Language:** TypeScript
- **Styling:** Vanilla CSS (เน้นความยืดหยุ่นและการควบคุมสไตล์เอง)
- **State Management:** React Hooks (`useState`, `useEffect`, `useRef`)
- **Key Techniques:** 
    - **CSS Container Queries:** ใช้สำหรับการคำนวณขนาด Font และตำแหน่งซับในหน้า Preview ให้ตรงกับวิดีโอจริงทุกขนาดหน้าจอ
    - **Dynamic Preview:** คำนวณตำแหน่ง Headline และ Subtitle แบบ Real-time ตาม Metadata ของวิดีโอ

### Backend
- **Framework:** FastAPI (Python)
- **AI Models:**
    - **Faster-Whisper (`large-v3-turbo`):** ใช้สำหรับ Transcribe เสียงเป็นข้อความพร้อม Timestamps ระดับคำ
    - **LM Studio (OpenAI-compatible API):** ใช้สำหรับฟีเจอร์ "AI Refinement" (เกลาคำภาษาไทยให้สละสลวย)
- **Processing Engines:**
    - **FFmpeg:** ใช้สำหรับ Extract Audio และ Encode วิดีโอสุดท้าย
    - **Libass:** ใช้สำหรับวาด Subtitle แบบ Advanced (Karaoke, Animations) ผ่านไฟล์ `.ass`
- **Thai NLP:**
    - **PyThaiNLP:** ใช้ทำ Word Segmentation และ Normalization ภาษาไทย (จัดการพวก "ๆ", เลขไทยเป็นเลขอารบิก ฯลฯ)

---

## 🚀 Workflows (ขั้นตอนการทำงาน)

### 1. Upload & Pre-processing (`/api/upload`)
- รับไฟล์วิดีโอ สร้าง `task_id` และโฟลเดอร์เก็บงานใน `temp_uploads/`
- **Step 1:** ใช้ FFmpeg ดึงเสียงออกมาเป็นไฟล์ `.wav` (16kHz Mono)
- **Step 2:** ใช้ Whisper Model ถอดเสียง (Transcribe) โดยเปิดโหมด `word_timestamps=True`

### 2. Thai Optimization & Grouping
- **Grouping:** นำคำเล็กๆ ที่ Whisper ถอดมาได้มาจัดกลุ่มใหม่ (Group) โดยใช้ PyThaiNLP เพื่อให้ประโยคซับไตเติ้ลไม่ตัดคำกลางประโยคดูน่าเกลียด
- **Normalization:** แก้ไขตัวสะกดเบื้องต้น และจัดการช่องว่าง (Spacing) ให้เป็นมาตรฐาน
- **AI Refinement (Optional):** ส่งข้อความไปที่ LM Studio ให้ AI ช่วยเกลาภาษาไทยให้เป็นธรรมชาติเหมือนคนพูดที่สุด

### 3. Customization Interface (Frontend)
- หน้าเว็บจะแสดงรายการซับไตเติ้ลที่ถอดได้
- ผู้ใช้สามารถ:
    - แก้ไขข้อความ (Text Edit)
    - ปรับเวลาเริ่ม/จบ (Time Sync)
    - ปรับแต่งสไตล์ (Font, Color, Size, Position, Animation)
    - เพิ่ม/ลบ Segment ได้อิสระ

### 4. Rendering Process (`/api/render/{task_id}`)
- Backend รับค่า Settings ทั้งหมดมาสร้างไฟล์ **Advanced Substation Alpha (.ass)**
- **Karaoke Logic:** Backend คำนวณความยาวของแต่ละคำในประโยค เพื่อสร้าง Effect ไฮไลต์สีตามเสียงพูด
- **FFmpeg Final Encode:** 
    - ใช้ Filter `ass` เพื่อฝังซับลงในวิดีโอ
    - รองรับ **NVIDIA CUDA (h264_nvenc)** เพื่อการ Render ที่รวดเร็ว (ถ้ามี GPU)
    - Fallback ไปที่ CPU (libx264) หากไม่มี GPU

---

## ✨ Features Highlight

### 📱 TikTok Style Subtitles
- **Dynamic Highlighting:** ไฮไลต์คำที่กำลังพูดอยู่ (Karaoke Effect)
- **Punchy Segments:** ระบบ Auto-split ให้ซับสั้น อ่านง่าย เหมาะกับคลิปแนวตั้ง
- **Pop/Fade Animations:** แอนิเมชันตอนซับปรากฏ

### 🏷️ Video Headline
- เพิ่ม "พาดหัวคลิป" ด้านบนที่ติดไปกับตัววิดีโอเลย
- ปรับสไตล์แยกต่างหากจากซับไตเติ้ล (Box Style, Outline Style)

### 🔠 Multi-Font Support
- รองรับฟอนต์ไทยยอดนิยม: **Kanit, Prompt, Mitr** (Backend มีระบบโหลดฟอนต์อัตโนมัติ)

### ⚡ Performance
- **Turbo ASR:** ใช้ Whisper-turbo ที่เร็วขึ้น 2-4 เท่าแต่ยังคงความแม่นยำสูง
- **Batch Processing:** ส่งข้อความให้ AI เกลาคำเป็นชุดๆ เพื่อลด overhead ของ API call

---

## 📂 Project Structure

```text
/
├── backend/
│   ├── main.py            # Logic หลักของ FastAPI และ AI Processing
│   ├── fonts/             # ที่เก็บไฟล์ .ttf สำหรับ Render
│   ├── temp_uploads/      # ที่เก็บไฟล์ชั่วคราวระหว่างประมวลผล
│   └── requirements.txt   # รายการ Library ของ Python
├── frontend/
│   ├── src/app/page.tsx   # หน้าจอหลักของแอป (Everything-in-one-page)
│   ├── public/            # Assets และ Static files
│   └── package.json       # รายการ Library ของ Node.js
└── start_all.bat          # สคริปต์สำหรับรัน Backend + Frontend พร้อมกัน
```

---
*Created & Maintained by Gemini CLI Agent*
