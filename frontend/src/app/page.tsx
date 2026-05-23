'use client';

import { useState, useRef, useEffect } from 'react';

type TaskStatus = {
  step: number;
  status: string;
  progress: number;
  result_url?: string;
  waiting_for_user?: boolean;
  step_time?: string;
};

type SubtitleItem = {
  index: number;
  start: number;
  end: number;
  content: string;
  words?: any[];
};

const STEPS = [
  "Uploading Video",
  "Extracting Audio",
  "Transcribing (High Precision)",
  "Refining Thai (LM Studio)",
  "Ready for Customization",
  "Burning Subtitles",
  "Complete"
];

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  
  // Helper to format time for display (detailed)
  const formatDetailedTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };

  const [isDragging, setIsDragging] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [statusData, setStatusData] = useState<TaskStatus | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Subtitle styling state
  const [fontSize, setFontSize] = useState(28);
  const [fontFamily, setFontFamily] = useState("Kanit");
  const [primaryColor, setPrimaryColor] = useState("#FFFFFF");
  const [outlineColor, setOutlineColor] = useState("#000000");
  const [outlineSize, setOutlineSize] = useState(3.0);
  const [highlightColor, setHighlightColor] = useState("#FFFF00");
  const [bgStyle, setBgStyle] = useState("outline"); // "outline", "shadow", "box", "glow"
  const [animationType, setAnimationType] = useState("karaoke"); // "none", "fade", "pop", "bounce", "karaoke"
  const [maxWords, setMaxWords] = useState(5);
  const [headline, setHeadline] = useState("");
  const [headlineSize, setHeadlineSize] = useState(36);
  const [headlineV, setHeadlineV] = useState(50);
  const [headlineFont, setHeadlineFont] = useState("Kanit");
  const [headlineColor, setHeadlineColor] = useState("#FFFFFF");
  const [headlineBgColor, setHeadlineBgColor] = useState("#000000");
  const [headlineBgStyle, setHeadlineBgStyle] = useState("box"); // "none", "box", "outline"
  const [headlineOutlineSize, setHeadlineOutlineSize] = useState(3);
  const [useLlm, setUseLlm] = useState(true);
  const [customVocab, setCustomVocab] = useState("Lucia AI");
  
  // New State for Subtitle Editor & Position
  const [subtitles, setSubtitles] = useState<SubtitleItem[]>([]);
  const [rawWords, setRawWords] = useState<any[]>([]); // Store original word-level data
  const [marginV, setMarginV] = useState(120);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number>(0); // Video total duration (Upgrade 5)
  const [autoScroll, setAutoScroll] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [lmConnected, setLmConnected] = useState<boolean | null>(null);

  // Check LM Studio Connection
  useEffect(() => {
    const checkLm = async () => {
      try {
        const res = await fetch('http://localhost:1234/v1/models');
        setLmConnected(res.ok);
      } catch (err) {
        setLmConnected(false);
      }
    };
    checkLm();
    const interval = setInterval(checkLm, 5000); // Re-check every 5 seconds
    return () => clearInterval(interval);
  }, []);

  // Fetch subtitles when waiting for user
  useEffect(() => {
    if (taskId && statusData?.waiting_for_user) {
      fetch(`http://localhost:8000/api/subtitles/${taskId}`)
        .then(res => res.json())
        .then(data => {
          setSubtitles(data);
          setRawWords(data); 
        })
        .catch(err => console.error("Error fetching subtitles:", err));
    }
  }, [taskId, statusData?.waiting_for_user]);

  // Handle Dynamic Re-grouping when maxWords changes (Respecting Segments)
  useEffect(() => {
    if (rawWords.length === 0) return;

    const newSubs: SubtitleItem[] = [];
    
    // Group original data by segment_id if available
    const segmentsMap = new Map();
    rawWords.forEach(s => {
      const segId = s.segment_id || 0;
      if (!segmentsMap.has(segId)) segmentsMap.set(segId, []);
      segmentsMap.get(segId).push(...(s.words || []));
    });

    segmentsMap.forEach((words) => {
      for (let i = 0; i < words.length; i += maxWords) {
        const chunk = words.slice(i, i + maxWords);
        const combinedText = chunk.map((w: any) => w.word).join("");
        
        newSubs.push({
          index: newSubs.length + 1,
          start: chunk[0].start,
          end: chunk[chunk.length - 1].end,
          content: combinedText,
          words: chunk
        });
      }
    });

    setSubtitles(newSubs);
  }, [maxWords, rawWords]);

  // Handle Video Time Update for Preview and Auto-scroll
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      const time = video.currentTime;
      setCurrentTime(time);
      
      // Auto-scroll logic
      if (statusData?.waiting_for_user && autoScroll) {
        const activeIndex = subtitles.findIndex(s => time >= s.start && time <= s.end);
        if (activeIndex !== -1) {
          const element = document.getElementById(`sub-item-${subtitles[activeIndex].index}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => video.removeEventListener('timeupdate', handleTimeUpdate);
  }, [subtitles, statusData?.waiting_for_user, autoScroll]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (videoRef.current) {
          if (videoRef.current.paused) videoRef.current.play();
          else videoRef.current.pause();
        }
      } else if (e.code === 'ArrowLeft') {
        if (videoRef.current) videoRef.current.currentTime -= 5;
      } else if (e.code === 'ArrowRight') {
        if (videoRef.current) videoRef.current.currentTime += 5;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const addSubtitle = () => {
    const newIndex = subtitles.length > 0 ? Math.max(...subtitles.map(s => s.index)) + 1 : 1;
    const start = videoRef.current ? videoRef.current.currentTime : 0;
    const newSub: SubtitleItem = {
      index: newIndex,
      start: start,
      end: start + 2.0,
      content: "พิมพ์คำบรรยายที่นี่"
    };
    
    const newSubs = [...subtitles, newSub].sort((a, b) => a.start - b.start);
    setSubtitles(newSubs);
  };

  const deleteSubtitle = (index: number) => {
    setSubtitles(subtitles.filter(s => s.index !== index));
  };

  const shiftTime = (amount: number) => {
    setSubtitles(subs => subs.map(sub => ({
      ...sub,
      start: Math.max(0, sub.start + amount),
      end: Math.max(0, sub.end + amount)
    })));
  };

  const jumpTo = (time: number) => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = time;
      
      setTimeout(() => {
        video.play().catch(error => {
          console.log("Playback prevented or failed:", error);
        });
      }, 50);
    }
  };

  // Polling logic
  useEffect(() => {
    let interval: NodeJS.Timeout;

    const checkStatus = async () => {
      if (!taskId) return;
      
      try {
        const res = await fetch(`http://localhost:8000/api/status/${taskId}`);
        if (res.ok) {
          const data: TaskStatus = await res.json();
          setStatusData(data);
          
          if (data.step === 6 && data.result_url) {
            setVideoUrl(`http://localhost:8000${data.result_url}`);
            setTaskId(null); // stop polling
          } else if (data.step === -1) {
            alert(`Error: ${data.status}`);
            setTaskId(null);
          }
        }
      } catch (err) {
        console.error("Polling error", err);
      }
    };

    if (taskId && !statusData?.waiting_for_user) {
      interval = setInterval(checkStatus, 1000);
    }

    return () => clearInterval(interval);
  }, [taskId, statusData?.waiting_for_user]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const selectedFile = e.dataTransfer.files[0];
      if (selectedFile.type.startsWith('video/')) {
        setFile(selectedFile);
      } else {
        alert('Please upload a video file (.mp4, .mov, etc.)');
      }
    }
  };

  const processVideo = async () => {
    if (!file) return;

    setStatusData({ step: 0, status: "Uploading Video...", progress: 0 });
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('use_llm', useLlm.toString());
    formData.append('custom_vocab', customVocab);

    try {
      const response = await fetch('http://localhost:8000/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Failed to start processing');

      const data = await response.json();
      setTaskId(data.task_id);
    } catch (error) {
      console.error(error);
      alert('Error starting video processing.');
      setStatusData(null);
    }
  };

  const startRender = async () => {
    if (!taskId) return;
    
    setStatusData(prev => prev ? { ...prev, waiting_for_user: false, step: 5, status: "Starting render..." } : null);
    
    try {
      const response = await fetch(`http://localhost:8000/api/render/${taskId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          font_size: fontSize,
          font_family: fontFamily,
          primary_color: primaryColor,
          outline_color: outlineColor,
          highlight_color: highlightColor,
          margin_v: marginV,
          bg_style: bgStyle,
          animation_type: animationType,
          max_words: maxWords,
          outline_size: outlineSize,
          headline: headline,
          headline_size: headlineSize,
          headline_v: headlineV,
          headline_font: headlineFont,
          headline_color: headlineColor,
          headline_bg_color: headlineBgColor,
          headline_bg_style: headlineBgStyle,
          headline_outline_size: headlineOutlineSize,
          subtitles: subtitles.length > 0 ? subtitles : undefined
        }),
      });

      if (!response.ok) throw new Error('Failed to start rendering');
    } catch (error) {
      console.error(error);
      alert('Error starting video render.');
    }
  };

  const reset = () => {
    setFile(null);
    setTaskId(null);
    setStatusData(null);
    setVideoUrl(null);
    setDuration(0);
  };

  const isProcessing = taskId !== null || (statusData !== null && statusData.step === 0);
  const isCustomizing = statusData?.waiting_for_user;

  return (
    <main className="container" style={{ maxWidth: isCustomizing ? '1800px' : '800px', transition: 'max-width 0.3s ease', paddingTop: '80px' }}>
      {/* Professional Navbar */}
      <nav style={{ 
        position: 'fixed', 
        top: 0, 
        left: 0, 
        right: 0, 
        height: '64px', 
        backgroundColor: 'rgba(5, 5, 5, 0.85)', 
        backdropFilter: 'blur(20px)', 
        borderBottom: '1px solid rgba(255,255,255,0.06)', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        padding: '0 30px', 
        zIndex: 1000 
      }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h1 style={{ fontSize: '1.2rem', margin: 0, background: 'linear-gradient(to right, #fff, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 800 }}>
            VDO Editor Lucia
          </h1>
          <span style={{ fontSize: '10px', color: '#888', fontWeight: 500 }}>Premium Thai Subtitle System</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          {/* LM Studio Connection Status */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px', 
            padding: '6px 12px', 
            backgroundColor: '#111', 
            borderRadius: '12px', 
            border: '1px solid #222' 
          }}>
            <div style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              backgroundColor: lmConnected === null ? '#fbbf24' : (lmConnected ? '#22c55e' : '#ef4444'),
              boxShadow: lmConnected ? '0 0 10px rgba(34, 197, 94, 0.4)' : 'none'
            }}></div>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#888' }}>
              LM STUDIO: {lmConnected === null ? 'CHECKING...' : (lmConnected ? 'CONNECTED' : 'DISCONNECTED')}
            </span>
          </div>
        </div>
      </nav>

      {!videoUrl ? (
        <div className="upload-card">
          {!isProcessing ? (
            <>
              <div 
                className={`drop-zone ${isDragging ? 'drag-active' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={(e) => setFile(e.target.files?.[0] || null)} 
                  onClick={(e) => e.stopPropagation()} 
                  accept="video/*"
                  style={{ display: 'none' }}
                />
                <svg className="upload-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <h2>{file ? file.name : 'เลือกหรือวางไฟล์วิดีโอ'}</h2>
                <p>{file ? 'คลิกที่นี่หากต้องการเปลี่ยนไฟล์' : 'รองรับรูปแบบ MP4, MOV, AVI สูงสุด 1GB'}</p>
              </div>

              <div style={{ margin: '15px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  id="useLlmToggle" 
                  className="ios-toggle"
                  checked={useLlm} 
                  onChange={(e) => setUseLlm(e.target.checked)} 
                />
                <label htmlFor="useLlmToggle" style={{ fontSize: '14px', color: '#9ca3af', cursor: 'pointer', fontWeight: 500 }}>
                  ใช้งาน AI (LM Studio) เกลาคำภาษาไทยอัตโนมัติ
                </label>
              </div>

              <div style={{ margin: '0 0 20px 0', width: '100%', textAlign: 'left' }}>
                <label style={{ display: 'block', fontSize: '14px', color: '#9ca3af', marginBottom: '8px', fontWeight: 500 }}>
                  คำศัพท์เฉพาะ / บริบท (ช่วยเสริมความแม่นยำในการถอดเสียง)
                </label>
                <input 
                  type="text" 
                  value={customVocab} 
                  onChange={(e) => setCustomVocab(e.target.value)} 
                  placeholder="เช่น: Minecraft, ตัดต้นไม้, Lucia AI, ชื่อคน" 
                  style={{ 
                    width: '100%', 
                    padding: '12px', 
                    borderRadius: '12px', 
                    border: '1px solid #24242b',
                    backgroundColor: '#0a0a0c',
                    color: '#f3f4f6',
                    fontSize: '14px',
                    outline: 'none'
                  }}
                />
              </div>

              <button 
                className="btn" 
                onClick={processVideo} 
                disabled={!file}
              >
                เริ่มประมวลผลคำบรรยาย
              </button>
            </>
          ) : (
            <div className="progress-container" style={{ width: '100%' }}>
              <div className="progress-header" style={{ marginBottom: '20px' }}>
                <span style={{ color: '#fff', fontSize: '1.1rem', fontWeight: 700 }}>{statusData?.status || "กำลังประมวลผล..."}</span>
                <span style={{ color: '#8b5cf6', fontWeight: 800, fontSize: '1.2rem' }}>{statusData?.progress || 0}%</span>
              </div>
              
              {statusData && statusData.step < 4 && (
                <ul className="step-list" style={{ marginBottom: '30px' }}>
                  {STEPS.map((stepName, index) => {
                    const currentStep = statusData?.step || 0;
                    let className = "step-item";
                    let timeInfo = null;

                    if (index < currentStep) {
                      className += " completed";
                      if (index === currentStep - 1 && statusData?.step_time) {
                        timeInfo = <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#8b5cf6', fontWeight: 600, backgroundColor: 'rgba(139,92,246,0.1)', padding: '2px 8px', borderRadius: '6px' }}>{statusData.step_time}</span>;
                      }
                    }
                    else if (index === currentStep) className += " active";
                    
                    return (
                      <li key={index} className={className} style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                        <div className="step-icon"></div>
                        <span style={{ fontWeight: index === currentStep ? 700 : 500 }}>{stepName}</span>
                        {timeInfo}
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* 3-Column Layout: Left (Appearance), Center (Preview & Timeline), Right (Editor) */}
              {statusData?.waiting_for_user && (
                <div className="customization-panel" style={{ 
                  marginTop: '10px', 
                  display: 'flex', 
                  flexDirection: 'row',
                  gap: '20px', 
                  alignItems: 'stretch',
                  width: '100%',
                  textAlign: 'left',
                  height: 'calc(100vh - 180px)',
                  overflow: 'hidden'
                }}>
                  {/* Column 1: Appearance (Left) */}
                  <div className="custom-scrollbar" style={{ 
                    flex: '0 0 310px', 
                    overflowY: 'auto',
                    paddingRight: '5px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '15px'
                  }}>
                    <div style={{ 
                      backgroundColor: 'rgba(22, 22, 26, 0.65)', 
                      backdropFilter: 'blur(16px)',
                      padding: '20px', 
                      borderRadius: '24px', 
                      border: '1px solid rgba(255,255,255,0.05)', 
                      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                      flex: '1',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '18px'
                    }}>
                      <h4 style={{ color: '#fff', marginTop: 0, marginBottom: '5px', fontSize: '1.1rem', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '12px', fontWeight: 800 }}>🎨 Subtitle Settings</h4>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                        <div>
                          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#9ca3af', marginBottom: '8px' }}>พาดหัววิดีโอ (Headline)</label>
                          <textarea 
                            placeholder="พิมพ์พาดหัวสุดปังที่นี่..." 
                            value={headline} 
                            onChange={(e) => setHeadline(e.target.value)} 
                            style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid #24242b', backgroundColor: '#050505', color: '#f3f4f6', fontSize: '13px', outline: 'none', marginBottom: headline ? '12px' : '0', resize: 'vertical', minHeight: '55px', fontFamily: 'inherit' }}
                          />
                          
                          {headline && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px', backgroundColor: '#09090b', borderRadius: '14px', border: '1px solid #1f1f23', marginTop: '5px' }}>
                              <div>
                                <label style={{ display: 'block', fontSize: '9px', fontWeight: 800, color: '#4b5563', textTransform: 'uppercase', marginBottom: '4px' }}>Headline Font</label>
                                <select value={headlineFont} onChange={(e) => setHeadlineFont(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #222', backgroundColor: '#050505', color: '#f3f4f6', fontSize: '12px' }}>
                                  <option value="Kanit">Kanit</option>
                                  <option value="Prompt">Prompt</option>
                                  <option value="Mitr">Mitr</option>
                                  <option value="Sarabun">Sarabun</option>
                                  <option value="Chakra Petch">Chakra Petch</option>
                                </select>
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                <div>
                                  <label style={{ fontSize: '9px', fontWeight: 800, color: '#4b5563' }}>SIZE {headlineSize}px</label>
                                  <input type="range" min="12" max="150" value={headlineSize} onChange={(e) => setHeadlineSize(Number(e.target.value))} style={{ width: '100%', accentColor: '#8b5cf6' }} />
                                </div>
                                <div>
                                  <label style={{ fontSize: '9px', fontWeight: 800, color: '#4b5563' }}>POS {headlineV}</label>
                                  <input type="range" min="0" max="720" value={headlineV} onChange={(e) => setHeadlineV(Number(e.target.value))} style={{ width: '100%', accentColor: '#8b5cf6' }} />
                                </div>
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                <div>
                                  <label style={{ display: 'block', fontSize: '9px', fontWeight: 800, color: '#4b5563', marginBottom: '4px' }}>TEXT COLOR</label>
                                  <input type="color" value={headlineColor} onChange={(e) => setHeadlineColor(e.target.value)} style={{ border: 'none', width: '24px', height: '24px', padding: 0, cursor: 'pointer', backgroundColor: 'transparent' }} />
                                </div>
                                <div>
                                  <label style={{ display: 'block', fontSize: '9px', fontWeight: 800, color: '#4b5563', marginBottom: '4px' }}>BG COLOR</label>
                                  <input type="color" value={headlineBgColor} onChange={(e) => setHeadlineBgColor(e.target.value)} style={{ border: 'none', width: '24px', height: '24px', padding: 0, cursor: 'pointer', backgroundColor: 'transparent' }} />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        <div>
                          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#9ca3af', marginBottom: '8px' }}>รูปแบบฟอนต์ (Sub Font)</label>
                          <select value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '12px', border: '1px solid #24242b', backgroundColor: '#050505', color: '#f3f4f6', fontSize: '13px', outline: 'none' }}>
                            <option value="Kanit">Kanit</option>
                            <option value="Prompt">Prompt</option>
                            <option value="Mitr">Mitr</option>
                            <option value="Sarabun">Sarabun (ใหม่)</option>
                            <option value="Chakra Petch">Chakra Petch (ใหม่)</option>
                          </select>
                        </div>

                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <label style={{ fontSize: '13px', fontWeight: 700, color: '#9ca3af' }}>ขนาดอักษร (Size)</label>
                            <span style={{ fontSize: '12px', fontWeight: 800, color: '#8b5cf6' }}>{fontSize}px</span>
                          </div>
                          <input type="range" min="12" max="100" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} style={{ width: '100%', accentColor: '#8b5cf6', cursor: 'pointer' }} />
                        </div>

                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <label style={{ fontSize: '13px', fontWeight: 700, color: '#9ca3af' }}>ตำแหน่งแนวตั้ง (Vertical Position)</label>
                            <span style={{ fontSize: '12px', fontWeight: 800, color: '#8b5cf6' }}>{marginV}</span>
                          </div>
                          <input type="range" min="0" max="720" value={marginV} onChange={(e) => setMarginV(Number(e.target.value))} style={{ width: '100%', accentColor: '#8b5cf6', cursor: 'pointer' }} />
                        </div>

                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <label style={{ fontSize: '13px', fontWeight: 700, color: '#9ca3af' }}>จำนวนคำต่อบรรทัด (Words / Line)</label>
                            <span style={{ fontSize: '12px', fontWeight: 800, color: '#8b5cf6' }}>{maxWords}</span>
                          </div>
                          <input type="range" min="1" max="15" step="1" value={maxWords} onChange={(e) => setMaxWords(Number(e.target.value))} style={{ width: '100%', accentColor: '#8b5cf6', cursor: 'pointer' }} />
                        </div>

                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <label style={{ fontSize: '13px', fontWeight: 700, color: '#9ca3af' }}>ความหนาขอบ/กล่อง (Outline / Box)</label>
                            <span style={{ fontSize: '12px', fontWeight: 800, color: '#8b5cf6' }}>{outlineSize}</span>
                          </div>
                          <input type="range" min="0" max="15" step="0.5" value={outlineSize} onChange={(e) => setOutlineSize(Number(e.target.value))} style={{ width: '100%', accentColor: '#8b5cf6', cursor: 'pointer' }} />
                        </div>

                        <div>
                          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#9ca3af', marginBottom: '8px' }}>สไตล์ซับไตเติ้ล (Style Mode)</label>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '6px' }}>
                            {['outline', 'shadow', 'box', 'glow'].map(style => (
                              <button key={style} onClick={() => setBgStyle(style)} style={{ padding: '8px', fontSize: '10px', borderRadius: '8px', border: bgStyle === style ? '2px solid #8b5cf6' : '1px solid #24242b', backgroundColor: bgStyle === style ? 'rgba(139,92,246,0.15)' : '#050505', color: bgStyle === style ? '#a855f7' : '#888', cursor: 'pointer', fontWeight: bgStyle === style ? 800 : 500, textTransform: 'capitalize' }}>
                                {style === 'glow' ? 'Neon Glow 🌟' : style}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#9ca3af', marginBottom: '8px' }}>แอนิเมชันซับ (Animation)</label>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                            {['none', 'fade', 'pop', 'bounce', 'karaoke'].map(anim => (
                              <button key={anim} onClick={() => setAnimationType(anim)} style={{ padding: '8px', fontSize: '10px', borderRadius: '8px', border: animationType === anim ? '2px solid #8b5cf6' : '1px solid #24242b', backgroundColor: animationType === anim ? 'rgba(139,92,246,0.15)' : '#050505', color: animationType === anim ? '#a855f7' : '#888', cursor: 'pointer', fontWeight: animationType === anim ? 800 : 500, textTransform: 'capitalize' }}>
                                {anim === 'karaoke' ? 'Karaoke 🎤' : (anim === 'bounce' ? 'Bounce 🦘' : anim)}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: '5px' }}>
                           <div style={{ backgroundColor: '#050505', padding: '8px', borderRadius: '12px', border: '1px solid #1f1f23', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                             <label style={{ display: 'block', fontSize: '8px', fontWeight: 800, color: '#555' }}>TEXT</label>
                             <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} style={{ border: 'none', width: '24px', height: '24px', padding: 0, cursor: 'pointer', backgroundColor: 'transparent' }} />
                           </div>
                           <div style={{ backgroundColor: '#050505', padding: '8px', borderRadius: '12px', border: '1px solid #1f1f23', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                             <label style={{ display: 'block', fontSize: '8px', fontWeight: 800, color: '#555' }}>OUTLINE</label>
                             <input type="color" value={outlineColor} onChange={(e) => setOutlineColor(e.target.value)} style={{ border: 'none', width: '24px', height: '24px', padding: 0, cursor: 'pointer', backgroundColor: 'transparent' }} />
                           </div>
                           <div style={{ backgroundColor: '#050505', padding: '8px', borderRadius: '12px', border: '1px solid #1f1f23', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                             <label style={{ display: 'block', fontSize: '8px', fontWeight: 800, color: '#555' }}>ACTIVE WORD</label>
                             <input type="color" value={highlightColor} onChange={(e) => setHighlightColor(e.target.value)} style={{ border: 'none', width: '24px', height: '24px', padding: 0, cursor: 'pointer', backgroundColor: 'transparent' }} />
                           </div>
                        </div>
                      </div>
                    </div>
                    <button className="btn" onClick={startRender} style={{ width: '100%', margin: 0, padding: '15px' }}>
                      🚀 Render Final Video
                    </button>
                  </div>

                  {/* Column 2: Live Editor Preview (Center) */}
                  <div style={{ 
                    flex: '1', 
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    overflow: 'hidden',
                    backgroundColor: 'rgba(22, 22, 26, 0.65)', 
                    backdropFilter: 'blur(16px)',
                    padding: '18px', 
                    borderRadius: '24px', 
                    boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
                    border: '1px solid rgba(255,255,255,0.05)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '3px' }}>
                      <span style={{ color: '#8b5cf6', fontSize: '14px', boxShadow: '0 0 10px #8b5cf6', borderRadius: '50%', width: '8px', height: '8px', backgroundColor: '#8b5cf6' }}></span>
                      <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#f3f4f6', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Live Editor Preview</h3>
                    </div>

                    <div id="video-preview-container" style={{ 
                      flex: '1',
                      width: '100%', 
                      borderRadius: '16px', 
                      overflow: 'hidden',
                      backgroundColor: '#000',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative'
                    }}>
                      <div style={{ 
                        position: 'relative', 
                        maxWidth: '100%', 
                        maxHeight: '100%',
                        containerType: 'size',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '100%',
                        height: '100%',
                        aspectRatio: '16 / 9'
                      }}>
                        {videoUrl || taskId ? (
                           <video
                             ref={videoRef}
                             src={videoUrl || (taskId ? `http://localhost:8000/api/video/${taskId}` : undefined)}
                             controls
                             preload="auto"
                             playsInline
                             onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                             style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                           />
                         ) : (
                           <div style={{ textAlign: 'center', color: '#888' }}>
                             <p>Waiting for video metadata...</p>
                           </div>
                         )}

                         {/* Headline Overlay */}
                         {headline && (
                          <div style={{
                            position: 'absolute',
                            top: `calc((${headlineV} / 720) * 100cqh)`,
                            left: '0',
                            width: '100%',
                            textAlign: 'center',
                            pointerEvents: 'none',
                            zIndex: 1,
                            padding: '0 10%'
                          }}>
                            <div style={{
                              fontFamily: headlineFont,
                              fontSize: `calc((${headlineSize} / 720) * 100cqh)`,
                              color: headlineColor,
                              backgroundColor: headlineBgStyle === 'box' ? `${headlineBgColor}CC` : 'transparent',
                              padding: headlineBgStyle === 'box' ? `calc((10 / 720) * 100cqh) calc((20 / 720) * 100cqh)` : `calc((5 / 720) * 100cqh)`, 
                              WebkitTextStroke: headlineBgStyle === 'outline' ? `calc((${headlineOutlineSize} / 720) * 100cqh) ${headlineBgColor}` : 'none',
                              paintOrder: 'stroke fill',
                              display: 'inline-block',
                              fontWeight: 800,
                              lineHeight: '1.2',
                              whiteSpace: 'pre-wrap',
                              textAlign: 'center'
                            }}>
                              {headline}
                            </div>
                          </div>
                         )}

                        <div style={{
                          position: 'absolute',
                          top: '15px',
                          left: '15px',
                          backgroundColor: 'rgba(0,0,0,0.85)',
                          border: '1px solid rgba(255,255,255,0.05)',
                          color: '#8b5cf6',
                          padding: '5px 12px',
                          borderRadius: '8px',
                          fontFamily: 'monospace',
                          fontSize: '13px',
                          fontWeight: 800,
                          zIndex: 2,
                          pointerEvents: 'none'
                        }}>
                          {formatDetailedTime(currentTime)}
                        </div>

                        {/* Subtitle Overlay */}
                        <div style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: '100%',
                          pointerEvents: 'none',
                          zIndex: 1,
                          padding: `0 5% calc((${marginV} / 720) * 100cqh) 5%`,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'flex-end'
                        }}>
                          {subtitles
                            .filter(sub => currentTime >= sub.start && currentTime <= sub.end)
                            .map((sub) => (
                              <div key={`${sub.index}-${animationType}-${bgStyle}`} style={{
                                fontFamily: fontFamily,
                                fontSize: `calc((${fontSize} / 720) * 100cqh)`, 
                                WebkitTextStroke: bgStyle === 'outline' ? `calc((${outlineSize} / 720) * 100cqh) ${outlineColor}` : 'none',
                                paintOrder: bgStyle === 'outline' ? 'stroke fill' : 'normal',
                                textShadow: bgStyle === 'shadow' ? `2px 2px 5px rgba(0,0,0,0.9)` : 
                                            (bgStyle === 'glow' ? `0 0 10px ${primaryColor}, 0 0 18px ${primaryColor}` : 
                                            (bgStyle === 'outline' ? `0px 2px 4px rgba(0,0,0,0.5)` : 'none')),
                                backgroundColor: bgStyle === 'box' ? 'rgba(0,0,0,0.65)' : 'transparent',
                                padding: bgStyle === 'box' ? '6px 16px' : '0',
                                borderRadius: bgStyle === 'box' ? '8px' : '0',
                                fontWeight: 800,
                                lineHeight: '1.25',
                                whiteSpace: 'pre-wrap',
                                display: 'inline-block',
                                animation: animationType === 'fade' ? 'subFadeIn 0.3s ease-out forwards' : 
                                           (animationType === 'pop' ? 'subPopIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards' : 
                                           (animationType === 'bounce' ? 'subBounceIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards' : 'none'))
                              }}>
                                {animationType === 'karaoke' && sub.words ? (
                                  sub.words.map((w, idx) => {
                                    const isWordActive = currentTime >= w.start && currentTime <= w.end;
                                    return (
                                      <span key={idx} style={{ color: isWordActive ? highlightColor : primaryColor, transition: 'color 0.1s ease' }}>
                                        {w.word}
                                      </span>
                                    );
                                  })
                                ) : (
                                  <span style={{ color: primaryColor }}>{sub.content}</span>
                                )}
                              </div>
                            ))
                          }
                        </div>
                      </div>
                    </div>

                    {/* Interactive Subtitle Timeline Component (Upgrade 5) */}
                    <div className="timeline-track-container">
                      <div className="timeline-header">
                        <span style={{ fontSize: '11px', fontWeight: 800, color: '#9ca3af', letterSpacing: '0.05em' }}>🎞️ VISUAL TIMELINE</span>
                        <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#ec4899', fontWeight: 800 }}>
                          {currentTime.toFixed(2)}s / {duration > 0 ? duration.toFixed(2) : '0.00'}s
                        </span>
                      </div>
                      
                      <div 
                        className="timeline-ruler custom-scrollbar" 
                        style={{ position: 'relative', width: '100%', height: '54px', overflowX: 'auto', backgroundColor: '#09090b', borderRadius: '10px', border: '1px solid #1c1c24' }}
                      >
                        <div style={{ position: 'relative', width: '100%', height: '100%', minWidth: duration > 0 ? `${Math.max(500, duration * 25)}px` : '100%' }}>
                          {/* Render Subtitle Bars */}
                          {subtitles.map((sub) => {
                            const isActive = currentTime >= sub.start && currentTime <= sub.end;
                            const leftPercent = duration > 0 ? (sub.start / duration) * 100 : 0;
                            const widthPercent = duration > 0 ? ((sub.end - sub.start) / duration) * 100 : 0;
                            
                            return (
                              <div
                                key={sub.index}
                                onClick={() => jumpTo(sub.start)}
                                className={`timeline-segment-block ${isActive ? 'active' : ''}`}
                                style={{
                                  left: `${leftPercent}%`,
                                  width: `${Math.max(3, widthPercent)}%`,
                                  top: '10px',
                                  fontSize: '10px',
                                  fontWeight: 800
                                }}
                                title={`Subtitle #${sub.index}: ${sub.content}`}
                              >
                                #{sub.index}
                              </div>
                            );
                          })}
                          
                          {/* Playhead indicator bar */}
                          {duration > 0 && (
                            <div 
                              className="timeline-current-indicator" 
                              style={{ left: `${(currentTime / duration) * 100}%` }}
                            >
                              <div className="timeline-current-handle" />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Column 3: Subtitle Editor (Right) */}
                  <div style={{ 
                    flex: '0 0 350px', 
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '15px',
                    overflow: 'hidden'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h4 style={{ margin: 0, fontSize: '1.1rem', color: '#fff', fontWeight: 800 }}>📝 Subtitles ({subtitles.length})</h4>
                      <button onClick={addSubtitle} style={{ padding: '8px 15px', borderRadius: '10px', backgroundColor: '#10b981', border: 'none', color: 'white', fontSize: '12px', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span>+ Add Segment</span>
                      </button>
                    </div>

                    {/* Search & Replace Utility */}
                    <div style={{ backgroundColor: 'rgba(22,22,26,0.65)', padding: '12px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input 
                          type="text" 
                          placeholder="Search for..." 
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          style={{ flex: 1, backgroundColor: '#050505', border: '1px solid #24242b', borderRadius: '8px', padding: '6px 10px', color: '#f3f4f6', fontSize: '12px', outline: 'none' }}
                        />
                        <input 
                          type="text" 
                          placeholder="Replace with..." 
                          value={replaceQuery}
                          onChange={(e) => setReplaceQuery(e.target.value)}
                          style={{ flex: 1, backgroundColor: '#050505', border: '1px solid #24242b', borderRadius: '8px', padding: '6px 10px', color: '#f3f4f6', fontSize: '12px', outline: 'none' }}
                        />
                      </div>
                      <button 
                        onClick={() => {
                          if (!searchQuery) return;
                          const n = subtitles.map(sub => ({
                            ...sub,
                            content: sub.content.split(searchQuery).join(replaceQuery)
                          }));
                          setSubtitles(n);
                        }}
                        style={{ width: '100%', padding: '8px', borderRadius: '8px', backgroundColor: '#24242b', color: '#f3f4f6', border: '1px solid rgba(255,255,255,0.05)', fontSize: '11px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2c2c35'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#24242b'}
                      >
                        🔄 Replace All Occurrences
                      </button>
                    </div>
                    
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', backgroundColor: 'rgba(22,22,26,0.65)', padding: '12px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <span style={{ fontSize: '10px', fontWeight: 800, color: '#4b5563' }}>SHIFT TIME</span>
                      {[-0.5, 0.5].map(val => (
                        <button key={val} onClick={() => shiftTime(val)} style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #24242b', backgroundColor: '#0a0a0c', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                          {val > 0 ? `+${val}` : val}s
                        </button>
                      ))}
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#9ca3af', marginLeft: 'auto', cursor: 'pointer' }}>
                        <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} style={{ accentColor: '#8b5cf6' }} />
                        Auto-Scroll
                      </label>
                    </div>

                    <div className="custom-scrollbar" style={{ 
                      flex: '1',
                      display: 'flex', 
                      flexDirection: 'column', 
                      gap: '12px', 
                      overflowY: 'auto', 
                      paddingRight: '4px' 
                    }}>
                      {subtitles.length > 0 ? subtitles.map((sub, idx) => {
                        const isActive = currentTime >= sub.start && currentTime <= sub.end;
                        const isSearchMatch = searchQuery && sub.content.toLowerCase().includes(searchQuery.toLowerCase());
                        
                        return (
                          <div 
                            key={sub.index} 
                            id={`sub-item-${sub.index}`}
                            onClick={() => jumpTo(sub.start)}
                            style={{ 
                              padding: '15px', 
                              border: isSearchMatch ? '2px solid #eab308' : (isActive ? '2px solid #8b5cf6' : '1px solid #24242b'), 
                              borderRadius: '16px', 
                              backgroundColor: isSearchMatch ? 'rgba(234, 179, 8, 0.05)' : (isActive ? 'rgba(139,92,246,0.05)' : '#0a0a0c'), 
                              boxShadow: isSearchMatch ? '0 0 15px rgba(234, 179, 8, 0.15)' : (isActive ? '0 0 15px rgba(139,92,246,0.1)' : 'none'),
                              transition: 'all 0.2s ease',
                              position: 'relative',
                              cursor: 'pointer'
                            }}
                          >
                            {isSearchMatch && (
                              <div style={{ position: 'absolute', top: '-10px', left: '20px', backgroundColor: '#eab308', color: '#000', fontSize: '9px', fontWeight: 900, padding: '2px 8px', borderRadius: '4px', zIndex: 3 }}>
                                FOUND MATCH
                              </div>
                            )}

                            <button 
                              onClick={(e) => { e.stopPropagation(); deleteSubtitle(sub.index); }}
                              style={{ 
                                position: 'absolute',
                                top: '10px',
                                right: '10px',
                                width: '24px',
                                height: '24px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: '50%',
                                border: 'none',
                                backgroundColor: 'transparent',
                                color: '#555',
                                fontSize: '20px',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                zIndex: 2,
                                padding: 0,
                                lineHeight: 1
                              }} 
                              onMouseEnter={(e) => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.backgroundColor = 'rgba(248,113,113,0.1)'; }} 
                              onMouseLeave={(e) => { e.currentTarget.style.color = '#555'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                            >
                              ×
                            </button>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }} onClick={(e) => e.stopPropagation()}>
                                 <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                   <div style={{ display: 'flex', alignItems: 'center', gap: '2px', backgroundColor: '#050505', padding: '2px', borderRadius: '8px', border: '1px solid #1f1f23' }}>
                                     <button onClick={(e) => { e.stopPropagation(); const n=[...subtitles]; n[idx].start = Math.max(0, n[idx].start - 0.1); setSubtitles(n); jumpTo(n[idx].start); }} style={{ width: '20px', height: '24px', border: 'none', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>-</button>
                                     <input type="number" step="0.1" value={sub.start.toFixed(1)} onChange={(e) => { const n=[...subtitles]; n[idx].start=parseFloat(e.target.value) || 0; setSubtitles(n); }} style={{ width: '50px', border: 'none', backgroundColor: 'transparent', color: '#ccc', fontSize: '12px', fontWeight: 700, textAlign: 'center', outline: 'none' }} />
                                     <button onClick={(e) => { e.stopPropagation(); const n=[...subtitles]; n[idx].start = n[idx].start + 0.1; setSubtitles(n); jumpTo(n[idx].start); }} style={{ width: '20px', height: '24px', border: 'none', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>+</button>
                                   </div>
                                   <span style={{ fontSize: '8px', color: '#555', fontWeight: 800 }}>START</span>
                                 </div>

                                 <span style={{ color: '#444', height: '28px', display: 'flex', alignItems: 'center' }}>-</span>

                                 <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                   <div style={{ display: 'flex', alignItems: 'center', gap: '2px', backgroundColor: '#050505', padding: '2px', borderRadius: '8px', border: '1px solid #1f1f23' }}>
                                     <button onClick={(e) => { e.stopPropagation(); const n=[...subtitles]; n[idx].end = Math.max(n[idx].start, n[idx].end - 0.1); setSubtitles(n); jumpTo(n[idx].end); }} style={{ width: '20px', height: '24px', border: 'none', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>-</button>
                                     <input type="number" step="0.1" value={sub.end.toFixed(1)} onChange={(e) => { const n=[...subtitles]; n[idx].end=parseFloat(e.target.value) || 0; setSubtitles(n); }} style={{ width: '50px', border: 'none', backgroundColor: 'transparent', color: '#ccc', fontSize: '12px', fontWeight: 700, textAlign: 'center', outline: 'none' }} />
                                     <button onClick={(e) => { e.stopPropagation(); const n=[...subtitles]; n[idx].end = n[idx].end + 0.1; setSubtitles(n); jumpTo(n[idx].end); }} style={{ width: '20px', height: '24px', border: 'none', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>+</button>
                                   </div>
                                   <span style={{ fontSize: '8px', color: '#555', fontWeight: 800 }}>END</span>
                                 </div>

                                 <div style={{ marginLeft: '4px', height: '28px', display: 'flex', alignItems: 'center', padding: '0 8px', borderRadius: '6px', backgroundColor: 'rgba(139,92,246,0.1)', color: '#a855f7', fontSize: '10px', fontWeight: 800 }}>
                                   {(sub.end - sub.start).toFixed(1)}s
                                 </div>
                              </div>
                            </div>
                            <textarea 
                              value={sub.content}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => { const n=[...subtitles]; n[idx].content=e.target.value; setSubtitles(n); }}
                              style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid #24242b', backgroundColor: '#050505', color: '#f3f4f6', fontSize: '13px', lineHeight: '1.5', minHeight: '55px', outline: 'none', resize: 'vertical' }}
                            />
                          </div>
                        );
                      }) : <p style={{ textAlign: 'center', color: '#444', padding: '40px', fontSize: '14px' }}>No subtitles found.</p>}
                    </div>
                    
                    <style jsx global>{`
                      @keyframes subFadeIn {
                        from { opacity: 0; transform: translateY(10px); }
                        to { opacity: 1; transform: translateY(0); }
                      }
                      @keyframes subPopIn {
                        0% { transform: scale(0.5); opacity: 0; }
                        70% { transform: scale(1.1); }
                        100% { transform: scale(1); opacity: 1; }
                      }
                      @keyframes subBounceIn {
                        0% { transform: scale(0.6); opacity: 0; }
                        50% { transform: scale(1.15); }
                        75% { transform: scale(0.95); }
                        100% { transform: scale(1); opacity: 1; }
                      }
                    `}</style>

                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="result-section">
          <div className="video-container" style={{ borderRadius: '24px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.8)' }}>
            <video src={videoUrl} controls autoPlay loop style={{ width: '100%' }} />
          </div>
          <button 
            className="btn" 
            onClick={() => {
              const a = document.createElement('a');
              a.href = videoUrl;
              a.download = `subtitled_${file?.name || 'video.mp4'}`;
              a.click();
            }}
            style={{ marginTop: '20px' }}
          >
            📥 Download Finished Video
          </button>
          <button className="btn btn-secondary" onClick={reset} style={{ marginTop: '12px' }}>
            🔄 Process Another Video
          </button>
        </div>
      )}
    </main>
  );
}
