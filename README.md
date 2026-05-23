# 🎬 VDO Editor Lucia - Setup Guide

แอปพลิเคชันสำหรับสร้างซับไตเติ้ลวิดีโออัตโนมัติ (AI Thai Subtitle) พร้อมฟีเจอร์ TikTok Style ปรับแต่งได้ครบวงจร

---

## 🛠️ ความต้องการของระบบ (Prerequisites)

ก่อนเริ่มใช้งานในเครื่องใหม่ กรุณาติดตั้งซอฟต์แวร์ต่อไปนี้:

1.  **Python (3.9 - 3.11):** [ดาวน์โหลด Python](https://www.python.org/downloads/)
2.  **Node.js (v18 ขึ้นไป):** [ดาวน์โหลด Node.js](https://nodejs.org/)
3.  **FFmpeg:** **สำคัญมาก** (ต้องตั้งค่า PATH ให้เรียกใช้ผ่าน Terminal ได้)
4.  **LM Studio (ไม่บังคับ):** สำหรับฟีเจอร์ AI เกลาคำภาษาไทยและ Auto-Emoji
5.  **NVIDIA GPU (แนะนำ):** เพื่อการประมวลผลที่รวดเร็ว (ต้องติดตั้ง CUDA Toolkit)

---

## 🚀 ขั้นตอนการติดตั้ง (Installation)

### 1. ส่วนของ Backend (Python)
เปิด Terminal ในโฟลเดอร์ `backend` แล้วรันคำสั่งดังนี้:

```bash
cd backend
# สร้าง Virtual Environment
py -m venv venv

# เปิดใช้งาน venv (Windows)
.\venv\Scripts\activate

# ติดตั้ง Library ที่จำเป็น
pip install -r requirements.txt

# ดาวน์โหลดฟอนต์ไทยมาตรฐาน
py download_fonts.py
```

### 2. ส่วนของ Frontend (Next.js)
เปิด Terminal ใหม่ในโฟลเดอร์ `frontend` แล้วรันคำสั่งดังนี้:

```bash
cd frontend
# ติดตั้ง Library
npm install
```

---

## 🏃 วิธีการรันโปรแกรม (Running the App)

### 1. สตาร์ท Backend
ใน Terminal ของ `backend` (ที่เปิดใช้งาน venv อยู่):
```bash
py main.py
```
*Backend จะรันอยู่ที่: `http://localhost:8000`*

### 2. สตาร์ท Frontend
ใน Terminal ของ `frontend`:
```bash
npm run dev
```
*Frontend จะรันอยู่ที่: `http://localhost:3000`*

---

## 💡 ฟีเจอร์ที่น่าสนใจ
*   **Viral Style:** ซับไตเติ้ลสั้น (Punchy) และมีการไฮไลต์คำต่อคำ (Dynamic Highlighting)
*   **Video Headline:** เพิ่มพาดหัวคลิปด้านบน ปรับขนาด สี และตำแหน่งได้อิสระ
*   **TikTok Animations:** ซับเด้ง (Pop) หรือเลือนเข้า (Fade)
*   **Auto-Emoji:** ใส่ Emoji อัตโนมัติตามเนื้อหา (ต้องเปิด LM Studio)
*   **Vertical Video Support:** รองรับวิดีโอแนวตั้ง (9:16) อย่างสมบูรณ์ในหน้า Preview

---

## 📂 โครงสร้างโฟลเดอร์ที่ควรคัดลอกไป
เมื่อต้องการย้ายเครื่อง ให้ก๊อปปี้โฟลเดอร์เหล่านี้ไป:
*   `backend/` (ไม่ต้องเอา `venv` และ `temp_uploads` ไป)
*   `frontend/` (ไม่ต้องเอา `node_modules` และ `.next` ไป)

---

*พัฒนาโดย Gemini CLI Agent*
