# 🎬 VDO Editor Auto Sub - Backend (Python/FastAPI)

ระบบประมวลผลวิดีโอและสร้างซับไตเติ้ลภาษาไทยอัตโนมัติ โดยเน้นความแม่นยำสูงและการ Render ที่รวดเร็ว

## 🛠 Tech Stack
- **Framework:** FastAPI (Python)
- **Speech-to-Text:** Faster-Whisper (biodatlab/whisper-th-medium-timestamp)
- **Thai NLP:** PyThaiNLP (Normalization & Word Tokenization)
- **AI Refinement:** LM Studio (Local LLM API)
- **Video Processing:** FFmpeg (with NVIDIA CUDA support)
- **Subtitle Format:** Advanced Substation Alpha (ASS)

## 📁 โครงสร้างไฟล์ที่สำคัญ
- `main.py`: ไฟล์หลักที่รวม API Endpoints, Logic การถอดความ และการ Render วิดีโอ
- `download_fonts.py`: สคริปต์สำหรับดาวน์โหลดฟอนต์ภาษาไทย (Kanit, Prompt, Mitr)
- `temp_uploads/`: โฟลเดอร์เก็บข้อมูลแยกตาม `task_id` (วิดีโอต้นฉบับ, เสียง, ไฟล์ ASS, วิดีโอผลลัพธ์)
- `fonts/`: โฟลเดอร์เก็บไฟล์ฟอนต์ `.ttf` สำหรับการ Burn-in ซับไตเติ้ล

## ⚙️ ขั้นตอนการทำงาน (Workflow)
1. **Upload:** รับวิดีโอ -> สร้าง `task_id` -> บันทึกลง `temp_uploads/{task_id}`
2. **Prepare:** 
   - สกัดเสียงแบบ 16kHz Mono (Optimized for Whisper)
   - Use Faster-Whisper ถอดความพร้อม Word-level timestamps
   - จัดกลุ่มคำภาษาไทยด้วย PyThaiNLP และ Normalize ข้อความ
   - (Optional) ส่งข้อความไปเกลาที่ LM Studio เพื่อแก้คำผิดและปรับการเว้นวรรค
   3. **Customize:** รอผู้ใช้ปรับแต่ง Style (Font, Color, Position) ผ่าน Frontend
   4. **Render:** 
   - สร้างไฟล์ `.ass` จากการตั้งค่าของผู้ใช้
   - ใช้ FFmpeg ประมวลผลวิดีโอ (รองรับ NVENC GPU Acceleration)
   - เพิ่ม `faststart` flag เพื่อให้วิดีโอพร้อมสำหรับ Social Media Streaming

## 🚀 การปรับปรุงในอนาคต (Maintenance Tips)
- **การลบไฟล์ขยะ:** มีระบบ `cleanup_old_tasks` ทำงานเป็น Background Task เมื่อมีการอัปโหลดใหม่ (ลบไฟล์ที่อายุเกิน 24 ชม.)
- **การปรับแต่ง AI:** แก้ไข `batch_refine_text` ใน `main.py` เพื่อปรับ Prompt สำหรับ AI Editor
- **การเพิ่มฟอนต์:** เพิ่มไฟล์ `.ttf` ในโฟลเดอร์ `fonts/` และอัปเดตรายการฟอนต์ใน Frontend
- **Memory Cleanup:** ระบบจะลบข้อมูลซับไตเติ้ลดิบออกจาก RAM ทันทีที่ Render เสร็จเพื่อประหยัดทรัพยากร
