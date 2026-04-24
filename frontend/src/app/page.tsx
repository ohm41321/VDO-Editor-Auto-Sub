'use client';

import { useState, useRef, useEffect } from 'react';

type TaskStatus = {
  step: number;
  status: string;
  progress: number;
  result_url?: string;
  waiting_for_user?: boolean;
};

type SubtitleItem = {
  index: number;
  start: number;
  end: number;
  content: string;
};

const STEPS = [
  "Uploading Video",
  "Extracting Audio",
  "Transcribing (Whisper AI)",
  "Refining Thai (LM Studio)",
  "Ready for Customization",
  "Burning Subtitles",
  "Complete"
];

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  // ... (rest of states)

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
  const [fontSize, setFontSize] = useState(24);
  const [fontFamily, setFontFamily] = useState("Kanit");
  const [primaryColor, setPrimaryColor] = useState("#FFFFFF");
  const [outlineColor, setOutlineColor] = useState("#000000");
  const [highlightColor, setHighlightColor] = useState("#FFFF00");
  const [bgStyle, setBgStyle] = useState("outline"); // "outline", "shadow", "box"
  const [animationType, setAnimationType] = useState("karaoke"); // "none", "fade", "pop", "karaoke"
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
  const [customVocab, setCustomVocab] = useState("Minecraft, ตัดต้นไม้กันเถอะ");
  
  // New State for Subtitle Editor & Position
  const [subtitles, setSubtitles] = useState<SubtitleItem[]>([]);
  const [rawWords, setRawWords] = useState<any[]>([]); // Store original word-level data
  const [marginV, setMarginV] = useState(20);
  const [currentTime, setCurrentTime] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);

  // Fetch subtitles when waiting for user
  useEffect(() => {
    if (taskId && statusData?.waiting_for_user) {
      fetch(`http://localhost:8000/api/subtitles/${taskId}`)
        .then(res => res.json())
        .then(data => {
          setSubtitles(data);
          // Store data with segment structure
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
      // Don't trigger shortcuts if user is typing in a textarea or input
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
    
    // Insert and sort by start time
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
      
      // Attempt to play after seeking
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
      
      // Resume polling
      // useEffect will naturally resume because waiting_for_user is now false
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
  };

  const isProcessing = taskId !== null || (statusData !== null && statusData.step === 0);
  const isCustomizing = statusData?.waiting_for_user;

  return (
    <main className="container" style={{ maxWidth: isCustomizing ? '1800px' : '800px', transition: 'max-width 0.3s ease' }}>
      <h1>Auto Thai Subtitler</h1>
      <p>Upload a video to generate and burn AI-powered Thai subtitles automatically.</p>

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
                <h2>{file ? file.name : 'Select or drop video'}</h2>
                <p>{file ? 'Click to change file' : 'MP4, MOV, AVI up to 1GB'}</p>
              </div>

              <div style={{ margin: '15px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  id="useLlmToggle" 
                  checked={useLlm} 
                  onChange={(e) => setUseLlm(e.target.checked)} 
                  style={{ cursor: 'pointer' }}
                />
                <label htmlFor="useLlmToggle" style={{ fontSize: '14px', color: '#666', cursor: 'pointer' }}>
                  ใช้งาน AI (LM Studio) เกลาคำอัตโนมัติ
                </label>
              </div>

              <div style={{ margin: '0 0 20px 0', width: '100%', textAlign: 'left' }}>
                <label style={{ display: 'block', fontSize: '14px', color: '#666', marginBottom: '8px' }}>
                  คำศัพท์เฉพาะ / บริบท (ช่วยให้ AI ฟังแม่นขึ้น)
                </label>
                <input 
                  type="text" 
                  value={customVocab} 
                  onChange={(e) => setCustomVocab(e.target.value)} 
                  placeholder="เช่น: Minecraft, ตัดต้นไม้, Lucia AI, ชื่อคน" 
                  style={{ 
                    width: '100%', 
                    padding: '10px', 
                    borderRadius: '8px', 
                    border: '1px solid #ddd',
                    fontSize: '14px'
                  }}
                />
              </div>

              <button 
                className="btn" 
                onClick={processVideo} 
                disabled={!file}
              >
                Generate Subtitles
              </button>
            </>
          ) : (
            <div className="progress-container">
              <div className="progress-header">
                <span>{statusData?.status || "Starting..."}</span>
                <span>{statusData?.progress || 0}%</span>
              </div>
              
              <ul className="step-list">
                {STEPS.map((stepName, index) => {
                  const currentStep = statusData?.step || 0;
                  let className = "step-item";
                  if (index < currentStep) className += " completed";
                  else if (index === currentStep) className += " active";
                  
                  return (
                    <li key={index} className={className}>
                      <div className="step-icon"></div>
                      <span>{stepName}</span>
                    </li>
                  );
                })}
              </ul>

              {/* Customization Panel - New Side-by-Side Layout */}
              {statusData?.waiting_for_user && (
                <div className="customization-panel" style={{ 
                  marginTop: '40px', 
                  display: 'flex', 
                  flexDirection: 'row',
                  gap: '30px', 
                  alignItems: 'flex-start',
                  width: '100%',
                  textAlign: 'left'
                }}>

                  {/* Left Column: Preview & Settings */}
                  <div style={{ 
                    flex: '3',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '20px',
                    position: 'sticky',
                    top: '20px',
                    maxHeight: 'calc(100vh - 40px)',
                    overflowY: 'auto',
                    paddingRight: '10px'
                  }}>
                    {/* Floating Cinematic Preview Section */}
                    <div style={{ 
                      width: '100%', 
                      backgroundColor: '#1a1a1a', 
                      padding: '25px', 
                      borderRadius: '24px', 
                      boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
                      border: '1px solid #333'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ color: '#0070f3' }}>●</span> Live Editor Preview
                        </h3>
                        <button className="btn" onClick={startRender} style={{ margin: 0, padding: '10px 25px', backgroundColor: '#0070f3', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
                          🚀 Finish & Render
                        </button>
                      </div>

                      <div id="video-preview-container" style={{ 
                        width: '100%', 
                        borderRadius: '16px', 
                        overflow: 'hidden',
                        backgroundColor: '#000',
                        maxHeight: '75vh',
                        minHeight: '300px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative',
                        boxShadow: '0 15px 40px rgba(0,0,0,0.6)'
                      }}>
                        {/* Wrapper that scales exactly with the video */}
                        <div style={{ 
                          position: 'relative', 
                          maxWidth: '100%', 
                          maxHeight: '75vh',
                          containerType: 'size',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '100%',
                          aspectRatio: '16 / 9'
                        }}>
                          {videoUrl || taskId ? (
                             <video
                               ref={videoRef}
                               src={videoUrl || (taskId ? `http://localhost:8000/api/video/${taskId}` : undefined)}
                               controls
                               preload="auto"
                               playsInline
                               onLoadedMetadata={() => console.log("✓ Video loaded:", videoUrl || `http://localhost:8000/api/video/${taskId}`)}
                               onError={(e) => console.error("✗ Video error:", e.currentTarget?.error?.message, "src:", e.currentTarget?.src)}
                               style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                             />
                           ) : (
                             <div style={{ textAlign: 'center', color: '#888' }}>
                               <p>Waiting for video...</p>
                             </div>
                           )}

                           {/* Headline Overlay - Persistent at Top */}
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
                                backgroundColor: headlineBgStyle === 'box' ? `${headlineBgColor}CC` : 'transparent', // CC = 80% opacity
                                padding: headlineBgStyle === 'box' ? `calc((10 / 720) * 100cqh) calc((20 / 720) * 100cqh)` : `calc((5 / 720) * 100cqh)`, 
                                WebkitTextStroke: headlineBgStyle === 'outline' ? `calc((${headlineOutlineSize} / 720) * 100cqh) ${headlineBgColor}` : 'none',
                                paintOrder: 'stroke fill',
                                display: 'inline-block',
                                fontWeight: 800,
                                border: 'none',
                                lineHeight: '1.2',
                                whiteSpace: 'pre-wrap',
                                textAlign: 'center'
                              }}>
                                {headline}
                              </div>
                            </div>
                           )}

                           {/* Timecode Counter Overlay - Positioned relative to video area */}

                          <div style={{
                            position: 'absolute',
                            top: '15px',
                            left: '15px',
                            backgroundColor: 'rgba(0,0,0,0.7)',
                            color: '#0070f3',
                            padding: '5px 12px',
                            borderRadius: '8px',
                            fontFamily: 'monospace',
                            fontSize: '14px',
                            fontWeight: 700,
                            border: '1px solid rgba(255,255,255,0.1)',
                            zIndex: 2,
                            pointerEvents: 'none'
                          }}>
                            {formatDetailedTime(currentTime)}
                          </div>

                          {/* Accurate Preview Overlay - Scaled exactly to video height */}
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
                                <div key={sub.index} style={{
                                  fontFamily: fontFamily,
                                  fontSize: `calc((${fontSize} / 720) * 100cqh)`, 
                                  WebkitTextStroke: bgStyle === 'outline' ? `calc((2 / 720) * 100cqh) ${outlineColor}` : 'none',
                                  paintOrder: bgStyle === 'outline' ? 'stroke fill' : 'normal',
                                  textShadow: bgStyle === 'shadow' ? `2px 2px 4px rgba(0,0,0,0.8), 0 0 10px rgba(0,0,0,0.5)` : (bgStyle === 'outline' ? `0px 2px 4px rgba(0,0,0,0.5)` : 'none'),
                                  backgroundColor: bgStyle === 'box' ? 'rgba(0,0,0,0.5)' : 'transparent',
                                  padding: bgStyle === 'box' ? '5px 15px' : '0',
                                  borderRadius: bgStyle === 'box' ? '8px' : '0',
                                  fontWeight: 700,
                                  lineHeight: '1.2',
                                  whiteSpace: 'pre-wrap',
                                  display: 'inline-block',
                                  animation: animationType === 'fade' ? 'subFadeIn 0.3s ease-out forwards' : (animationType === 'pop' ? 'subPopIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards' : 'none')
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

                      <style jsx global>{`
                        @keyframes subFadeIn {
                          from { opacity: 0; transform: translateY(5px); }
                          to { opacity: 1; transform: translateY(0); }
                        }
                        @keyframes subPopIn {
                          0% { transform: scale(0.8); opacity: 0; }
                          70% { transform: scale(1.05); }
                          100% { transform: scale(1); opacity: 1; }
                        }
                      `}</style>

                      {/* Quick Presets Bar */}
                      <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
                        {[
                          { label: '🎮 Gamer', font: 'Kanit', size: 42, color: '#FFFF00', outline: '#000000', v: 60 },
                          { label: '🏙️ Minimal', font: 'Prompt', size: 32, color: '#FFFFFF', outline: '#000000', v: 40 },
                          { label: '📢 Bold', font: 'Mitr', size: 48, color: '#FF0000', outline: '#FFFFFF', v: 80 }
                        ].map(p => (
                          <button 
                            key={p.label}
                            onClick={() => {
                              setFontFamily(p.font); setFontSize(p.size);
                              setPrimaryColor(p.color); setOutlineColor(p.outline);
                              setMarginV(p.v);
                            }}
                            style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '10px', cursor: 'pointer', border: '1px solid #444', backgroundColor: '#2a2a2a', color: '#eee' }}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* High-Contrast Settings Panel */}
                    <div style={{ 
                      backgroundColor: '#161616', 
                      padding: '20px', 
                      borderRadius: '24px', 
                      border: '1px solid #2a2a2a', 
                      boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
                    }}>
                      <h4 style={{ color: '#fff', marginTop: 0, marginBottom: '20px', fontSize: '1.1rem', borderBottom: '1px solid #2a2a2a', paddingBottom: '12px', fontWeight: 600 }}>🎨 Appearance</h4>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <div>
                          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#aaa', marginBottom: '8px' }}>Video Headline (Top Title)</label>
                          <textarea 
                            placeholder="Enter catchy headline... (Enter for new line)" 
                            value={headline} 
                            onChange={(e) => setHeadline(e.target.value)} 
                            style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid #333', backgroundColor: '#000', color: '#fff', fontSize: '14px', outline: 'none', marginBottom: headline ? '15px' : '0', resize: 'vertical', minHeight: '60px', fontFamily: 'inherit' }}
                          />
                          
                          {headline && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', padding: '18px', backgroundColor: '#111', borderRadius: '18px', border: '1px solid #2a2a2a', marginTop: '10px' }}>
                              
                              <div>
                                <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, color: '#555', textTransform: 'uppercase', marginBottom: '6px' }}>Headline Font</label>
                                <select value={headlineFont} onChange={(e) => setHeadlineFont(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '10px', border: '1px solid #333', backgroundColor: '#000', color: '#fff', fontSize: '13px' }}>
                                  <option value="Kanit">Kanit</option>
                                  <option value="Prompt">Prompt</option>
                                  <option value="Mitr">Mitr</option>
                                </select>
                              </div>

                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                <div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                    <label style={{ fontSize: '10px', fontWeight: 800, color: '#555' }}>SIZE</label>
                                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#0070f3' }}>{headlineSize}px</span>
                                  </div>
                                  <input type="range" min="12" max="150" value={headlineSize} onChange={(e) => setHeadlineSize(Number(e.target.value))} style={{ width: '100%', accentColor: '#0070f3' }} />
                                </div>
                                <div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                    <label style={{ fontSize: '10px', fontWeight: 800, color: '#555' }}>POSITION</label>
                                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#0070f3' }}>{headlineV}</span>
                                  </div>
                                  <input type="range" min="0" max="720" value={headlineV} onChange={(e) => setHeadlineV(Number(e.target.value))} style={{ width: '100%', accentColor: '#0070f3' }} />
                                </div>
                              </div>

                              <div>
                                <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, color: '#555', textTransform: 'uppercase', marginBottom: '8px' }}>Background Style</label>
                                <div style={{ display: 'flex', gap: '5px' }}>
                                  {['none', 'box', 'outline'].map(style => (
                                    <button
                                      key={style}
                                      onClick={() => setHeadlineBgStyle(style)}
                                      style={{
                                        flex: 1,
                                        padding: '6px',
                                        fontSize: '11px',
                                        borderRadius: '8px',
                                        border: headlineBgStyle === style ? '2px solid #0070f3' : '1px solid #333',
                                        backgroundColor: headlineBgStyle === style ? 'rgba(0,112,243,0.1)' : '#000',
                                        color: headlineBgStyle === style ? '#0070f3' : '#666',
                                        cursor: 'pointer',
                                        textTransform: 'capitalize'
                                      }}
                                    >
                                      {style}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {headlineBgStyle === 'outline' && (
                                <div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                    <label style={{ fontSize: '10px', fontWeight: 800, color: '#555' }}>OUTLINE THICKNESS</label>
                                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#0070f3' }}>{headlineOutlineSize}px</span>
                                  </div>
                                  <input type="range" min="1" max="20" value={headlineOutlineSize} onChange={(e) => setHeadlineOutlineSize(Number(e.target.value))} style={{ width: '100%', accentColor: '#0070f3' }} />
                                </div>
                              )}

                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                <div>
                                  <label style={{ display: 'block', fontSize: '10px', fontWeight: 800, color: '#555', marginBottom: '6px' }}>TEXT COLOR</label>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input type="color" value={headlineColor} onChange={(e) => setHeadlineColor(e.target.value)} style={{ border: 'none', width: '25px', height: '25px', padding: 0, borderRadius: '4px', cursor: 'pointer', backgroundColor: 'transparent' }} />
                                    <span style={{ fontSize: '10px', color: '#fff', fontFamily: 'monospace' }}>{headlineColor}</span>
                                  </div>
                                </div>
                                {headlineBgStyle !== 'none' && (
                                  <div>
                                    <label style={{ display: 'block', fontSize: '10px', fontWeight: 800, color: '#555', marginBottom: '6px' }}>{headlineBgStyle.toUpperCase()} COLOR</label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <input type="color" value={headlineBgColor} onChange={(e) => setHeadlineBgColor(e.target.value)} style={{ border: 'none', width: '25px', height: '25px', padding: 0, borderRadius: '4px', cursor: 'pointer', backgroundColor: 'transparent' }} />
                                      <span style={{ fontSize: '10px', color: '#fff', fontFamily: 'monospace' }}>{headlineBgColor}</span>
                                    </div>
                                  </div>
                                )}
                              </div>

                            </div>
                          )}
                        </div>

                        <div>
                          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#aaa', marginBottom: '8px' }}>Font Family</label>
                          <select value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '12px', border: '1px solid #333', backgroundColor: '#000', color: '#fff', fontSize: '14px', outline: 'none' }}>
                            <option value="Kanit">Kanit (Default)</option>
                            <option value="Prompt">Prompt</option>
                            <option value="Mitr">Mitr</option>
                          </select>
                        </div>

                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <label style={{ fontSize: '13px', fontWeight: 600, color: '#aaa' }}>Font Size</label>
                            <span style={{ fontSize: '13px', fontWeight: 700, color: '#0070f3' }}>{fontSize}px</span>
                          </div>
                          <input type="range" min="12" max="100" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} style={{ width: '100%', accentColor: '#0070f3', cursor: 'pointer' }} />
                        </div>

                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <label style={{ fontSize: '13px', fontWeight: 600, color: '#aaa' }}>Position</label>
                            <span style={{ fontSize: '13px', fontWeight: 700, color: '#0070f3' }}>{marginV}</span>
                          </div>
                          <input type="range" min="0" max="720" value={marginV} onChange={(e) => setMarginV(Number(e.target.value))} style={{ width: '100%', accentColor: '#0070f3', cursor: 'pointer' }} />
                        </div>

                        <div>
                          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#aaa', marginBottom: '8px' }}>Background Style</label>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            {[
                              { id: 'outline', label: 'Outline' },
                              { id: 'shadow', label: 'Shadow' },
                              { id: 'box', label: 'Box' }
                            ].map(style => (
                              <button
                                key={style.id}
                                onClick={() => setBgStyle(style.id)}
                                style={{
                                  flex: 1,
                                  padding: '10px',
                                  fontSize: '12px',
                                  borderRadius: '10px',
                                  border: bgStyle === style.id ? '2px solid #0070f3' : '1px solid #333',
                                  backgroundColor: bgStyle === style.id ? 'rgba(0,112,243,0.1)' : '#111',
                                  color: bgStyle === style.id ? '#0070f3' : '#888',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s ease',
                                  fontWeight: bgStyle === style.id ? 700 : 500
                                }}
                              >
                                {style.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#aaa', marginBottom: '8px' }}>Animation</label>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {[
                              { id: 'none', label: 'None' },
                              { id: 'fade', label: 'Fade' },
                              { id: 'pop', label: 'Pop' },
                              { id: 'karaoke', label: 'Highlight' }
                            ].map(anim => (
                              <button
                                key={anim.id}
                                onClick={() => setAnimationType(anim.id)}
                                style={{
                                  flex: '1 0 45%',
                                  padding: '10px',
                                  fontSize: '12px',
                                  borderRadius: '10px',
                                  border: animationType === anim.id ? '2px solid #0070f3' : '1px solid #333',
                                  backgroundColor: animationType === anim.id ? 'rgba(0,112,243,0.1)' : '#111',
                                  color: animationType === anim.id ? '#0070f3' : '#888',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s ease',
                                  fontWeight: animationType === anim.id ? 700 : 500
                                }}
                              >
                                {anim.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <label style={{ fontSize: '13px', fontWeight: 600, color: '#aaa' }}>Max Words (Punchy)</label>
                            <span style={{ fontSize: '13px', fontWeight: 700, color: '#0070f3' }}>{maxWords}</span>
                          </div>
                          <input type="range" min="1" max="15" value={maxWords} onChange={(e) => setMaxWords(Number(e.target.value))} style={{ width: '100%', accentColor: '#0070f3', cursor: 'pointer' }} />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                           <div style={{ backgroundColor: '#111', padding: '12px', borderRadius: '14px', border: '1px solid #2a2a2a' }}>
                            <label style={{ display: 'block', fontSize: '10px', fontWeight: 800, color: '#555', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Text Color</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} style={{ border: 'none', width: '30px', height: '30px', padding: 0, borderRadius: '6px', cursor: 'pointer', backgroundColor: 'transparent' }} />
                              <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#fff', fontWeight: 600 }}>{primaryColor.toUpperCase()}</span>
                            </div>
                           </div>
                           <div style={{ backgroundColor: '#111', padding: '12px', borderRadius: '14px', border: '1px solid #2a2a2a' }}>
                            <label style={{ display: 'block', fontSize: '10px', fontWeight: 800, color: '#555', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Highlight</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <input type="color" value={highlightColor} onChange={(e) => setHighlightColor(e.target.value)} style={{ border: 'none', width: '30px', height: '30px', padding: 0, borderRadius: '6px', cursor: 'pointer', backgroundColor: 'transparent' }} />
                              <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#fff', fontWeight: 600 }}>{highlightColor.toUpperCase()}</span>
                            </div>
                           </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Subtitle Editor Section */}
                  <div style={{ flex: '1' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginBottom: '20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h4 style={{ margin: 0, fontSize: '1.2rem', color: '#fff', fontWeight: 700 }}>📝 Edit Subtitles</h4>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#aaa', cursor: 'pointer', userSelect: 'none' }}>
                            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} style={{ accentColor: '#0070f3' }} />
                            Auto-Scroll
                          </label>
                          <button onClick={addSubtitle} style={{ padding: '10px 18px', borderRadius: '12px', backgroundColor: '#22c55e', border: 'none', color: 'white', fontSize: '14px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', transition: 'all 0.2s ease', boxShadow: '0 4px 12px rgba(34,197,94,0.3)' }}>
                            <span>+</span> Add Segment
                          </button>
                        </div>
                      </div>
                      
                      {/* Shift Time Tools */}
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', backgroundColor: '#161616', padding: '12px', borderRadius: '16px', border: '1px solid #2a2a2a' }}>
                        <span style={{ fontSize: '11px', fontWeight: 800, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Shift All:</span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          {[-0.5, -0.1, 0.1, 0.5].map(val => (
                            <button 
                              key={val} 
                              onClick={() => shiftTime(val)}
                              style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #333', backgroundColor: '#222', color: '#eee', fontSize: '12px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s ease' }}
                            >
                              {val > 0 ? `+${val}` : val}s
                            </button>
                          ))}
                        </div>
                        <span style={{ fontSize: '12px', color: '#666', fontStyle: 'italic' }}>Sync adjustment</span>
                      </div>
                    </div>
                    <div style={{ 
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '15px'
                    }}>
                      {subtitles.length > 0 ? subtitles.map((sub, idx) => {
                        const isActive = currentTime >= sub.start && currentTime <= sub.end;
                        return (
                          <div 
                            key={sub.index} 
                            id={`sub-item-${sub.index}`}
                            style={{ 
                              padding: '20px', 
                              border: isActive ? '2px solid #0070f3' : '1px solid #2a2a2a', 
                              borderRadius: '20px', 
                              backgroundColor: isActive ? 'rgba(0,112,243,0.05)' : '#111', 
                              boxShadow: isActive ? '0 10px 30px rgba(0,112,243,0.15)' : 'none',
                              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                 <div style={{ backgroundColor: '#222', padding: '5px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: 800, color: '#888', border: '1px solid #333' }}>#{idx+1}</div>
                                 <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                   <span style={{ fontSize: '10px', color: '#555', fontWeight: 800, letterSpacing: '0.05em' }}>START</span>
                                   <input type="number" step="0.1" value={sub.start} onChange={(e) => { const n=[...subtitles]; n[idx].start=parseFloat(e.target.value); setSubtitles(n); }} style={{ width: '80px', padding: '6px', borderRadius: '8px', border: '1px solid #333', backgroundColor: '#000', color: '#fff', fontSize: '13px', fontWeight: 700, outline: 'none' }} />
                                 </div>
                                 <span style={{ color: '#444', marginTop: '15px', fontWeight: 700 }}>→</span>
                                 <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                   <span style={{ fontSize: '10px', color: '#555', fontWeight: 800, letterSpacing: '0.05em' }}>END</span>
                                   <input type="number" step="0.1" value={sub.end} onChange={(e) => { const n=[...subtitles]; n[idx].end=parseFloat(e.target.value); setSubtitles(n); }} style={{ width: '80px', padding: '6px', borderRadius: '8px', border: '1px solid #333', backgroundColor: '#000', color: '#fff', fontSize: '13px', fontWeight: 700, outline: 'none' }} />
                                 </div>
                                 <div style={{ marginLeft: '5px', marginTop: '15px', fontSize: '11px', color: '#0070f3', fontWeight: 700, backgroundColor: 'rgba(0,112,243,0.1)', padding: '4px 10px', borderRadius: '8px' }}>
                                    {(sub.end - sub.start).toFixed(2)}s
                                 </div>
                              </div>
                              <div style={{ display: 'flex', gap: '10px' }}>
                                <button onClick={() => jumpTo(sub.start)} style={{ padding: '8px 14px', borderRadius: '10px', border: 'none', backgroundColor: '#1e3a8a', color: '#60a5fa', fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s ease' }}>▶ Play</button>
                                <button onClick={() => deleteSubtitle(sub.index)} style={{ padding: '8px 14px', borderRadius: '10px', border: 'none', backgroundColor: '#450a0a', color: '#f87171', fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s ease' }}>🗑</button>
                              </div>
                            </div>
                            <textarea 
                              value={sub.content}
                              onChange={(e) => { const n=[...subtitles]; n[idx].content=e.target.value; setSubtitles(n); }}
                              style={{ width: '100%', padding: '15px', borderRadius: '16px', border: '1px solid #2a2a2a', backgroundColor: '#000', color: '#fff', fontSize: '15px', lineHeight: '1.6', minHeight: '90px', outline: 'none', resize: 'vertical', transition: 'border-color 0.2s ease' }}
                              onFocus={(e) => e.target.style.borderColor = '#0070f3'}
                              onBlur={(e) => e.target.style.borderColor = '#2a2a2a'}
                            />
                          </div>
                        );
                      }) : <p style={{ textAlign: 'center', color: '#444', padding: '60px', fontSize: '1.1rem' }}>No subtitles found. Click "Add Segment" to start.</p>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="result-section">
          <div className="video-container">
            <video src={videoUrl} controls autoPlay loop />
          </div>
          <button 
            className="btn" 
            onClick={() => {
              const a = document.createElement('a');
              a.href = videoUrl;
              a.download = `subtitled_${file?.name || 'video.mp4'}`;
              a.click();
            }}
          >
            Download Video
          </button>
          <button className="btn btn-secondary" onClick={reset}>
            Process Another
          </button>
        </div>
      )}
    </main>
  );
}
