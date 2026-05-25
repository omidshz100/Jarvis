import React, { useState, useEffect, useRef, Suspense } from 'react';
import { 
  Mic, Send, Activity, Cpu, Cloud, Settings, 
  TerminalSquare, Clock, Shield, Battery, User, X, Upload, Square, Play, Pause, RotateCcw, Video, Plus, Trash2, Edit2, Copy
} from 'lucide-react';
import ReactPlayer from 'react-player';
import './App.css';
import { KnowledgeBase } from './KnowledgeBase';
import { MediaCarousel } from './MediaCarousel';
import { streamLLMResponse, generateEmbedding } from './llmService';
import { initVoice, speakText, interruptSpeaking, preInitializeVoice, togglePlayPause, setPlaybackRate as setVoiceRate, stopSpeaking } from './voiceService';
import { Canvas } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { Avatar } from './Avatar';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;

function App() {
  const [messages, setMessages] = useState([
    { role: 'jarvis', text: 'Good evening. All systems are online. How may I assist you today?' }
  ]);
  const [input, setInput] = useState('');
  
  // Explicit Conversation State Machine
  // IDLE | USER_SPEAKING | PROCESSING_STT | PROCESSING_LLM | PROCESSING_TTS | AVATAR_SPEAKING | AVATAR_PAUSED
  const [conversationState, setConversationState] = useState('IDLE');
  const [playingMessageIndex, setPlayingMessageIndex] = useState(-1);
  const [playbackRate, setPlaybackRate] = useState(1);
  
  const messagesEndRef = useRef(null);
  const [time, setTime] = useState(new Date().toLocaleTimeString());

  const [avatarUrl, setAvatarUrl] = useState(() => {
    return localStorage.getItem('jarvis_avatar_url') || '/models/Avatar_m2.vrm';
  });
  const [avatarExt, setAvatarExt] = useState(() => {
    return localStorage.getItem('jarvis_avatar_ext') || 'vrm';
  });
  const [avatarPos, setAvatarPos] = useState({ x: 0, y: -1.5 });
  const [gesture, setGesture] = useState('idle');
  const fileInputRef = useRef(null);
  
  const abortControllerRef = useRef(null);
  
  const [activeArticle, setActiveArticle] = useState(null);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      const ext = file.name.split('.').pop().toLowerCase();
      setAvatarUrl(url);
      setAvatarExt(ext);
    }
  };

  const [showSettings, setShowSettings] = useState(false);
  const [showPoseEditor, setShowPoseEditor] = useState(false);
  const [editingGesture, setEditingGesture] = useState('idle');
  const [draftGestures, setDraftGestures] = useState(null);
  const [editingBone, setEditingBone] = useState(null);
  const [isDraggingGizmo, setIsDraggingGizmo] = useState(false);

  const handleBoneRotate = (bone, rotation) => {
    setDraftGestures(prev => ({
      ...prev,
      [editingGesture]: {
        ...(prev?.[editingGesture] || {}),
        [bone]: rotation
      }
    }));
  };

  const [customGestures, setCustomGestures] = useState(() => {
    const saved = localStorage.getItem('jarvis_custom_gestures');
    return saved ? JSON.parse(saved) : {};
  });

  useEffect(() => {
    localStorage.setItem('jarvis_custom_gestures', JSON.stringify(customGestures));
  }, [customGestures]);

  const [showKnowledgeBase, setShowKnowledgeBase] = useState(false);
  const [showVideoLibrary, setShowVideoLibrary] = useState(false);
  const [videoLibraryView, setVideoLibraryView] = useState('list');
  const [editingVideo, setEditingVideo] = useState({ id: '', title: '', url: '', description: '', tags: '' });
  
  const [videoRegistry, setVideoRegistry] = useState(() => {
    const saved = localStorage.getItem('jarvis_video_registry');
    return saved ? JSON.parse(saved) : [];
  });
  
  useEffect(() => {
    localStorage.setItem('jarvis_video_registry', JSON.stringify(videoRegistry));
  }, [videoRegistry]);

  const [activeVideoUrl, setActiveVideoUrl] = useState(null);
  const pendingVideoUrlRef = useRef(null);

  const [config, setConfig] = useState(() => {
    const saved = localStorage.getItem('jarvis_llm_config');
    return saved ? JSON.parse(saved) : {
      provider: 'gemini',
      geminiKey: '',
      openaiKey: '',
      ollamaUrl: 'http://localhost:11434',
      ollamaModel: 'llama3'
    };
  });
  
  useEffect(() => {
    localStorage.setItem('jarvis_llm_config', JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, conversationState]);

  useEffect(() => {
    initVoice(
      () => setConversationState('AVATAR_SPEAKING'), // onStart
      () => {
        if (pendingVideoUrlRef.current) {
          setActiveVideoUrl(pendingVideoUrlRef.current);
          setConversationState('PLAYING_VIDEO');
          pendingVideoUrlRef.current = null;
        } else {
          setConversationState('IDLE');
        }
        setPlayingMessageIndex(-1);
      }, // onEnd
      () => setConversationState('PROCESSING_TTS')   // onFetchStart
    );
  }, []);

  useEffect(() => {
    if (!recognition) return;
    
    // We want it to stay open until user clicks Send
    recognition.continuous = true;
    recognition.interimResults = true;
    
    recognition.onresult = (event) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript) {
        setInput(prev => (prev ? prev + ' ' : '') + finalTranscript);
      }
    };
    
    recognition.onerror = (e) => {
      console.error('Speech Rec Error', e);
      if (conversationState === 'USER_SPEAKING') {
        setConversationState('IDLE');
      }
    };
    
    recognition.onend = () => {
      // If it ends naturally and we are still in USER_SPEAKING, just wait for Send
    };
  }, [conversationState]);

  const toggleListen = () => {
    preInitializeVoice();
    if (!recognition) return alert('Speech Recognition not supported in this browser. Try Chrome/Edge.');
    
    if (conversationState === 'IDLE') {
      setConversationState('USER_SPEAKING');
      recognition.start();
    }
  };

  const handleInterrupt = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    interruptSpeaking();
    setConversationState('IDLE');
    setPlayingMessageIndex(-1);
    setActiveVideoUrl(null);
    pendingVideoUrlRef.current = null;
  };

  const checkKnowledgeBase = (query, registry) => {
    const lowerQuery = query.toLowerCase();
    for (const video of registry) {
      if (video.tags.some(tag => lowerQuery.includes(tag.toLowerCase())) ||
          lowerQuery.includes(video.title.toLowerCase())) {
        return video;
      }
    }
    return null;
  };

  const handleSend = async () => {
    preInitializeVoice();
    
    if (conversationState === 'USER_SPEAKING' && recognition) {
      recognition.stop();
    }
    
    if (!input.trim()) {
      setConversationState('IDLE');
      return;
    }
    
    interruptSpeaking(); // Clear anything lingering
    setConversationState('PROCESSING_STT'); // Briefly show STT, though browser STT is fast
    
    const userText = input;
    const newHistory = [...messages, { role: 'user', text: userText }];
    
    setMessages([...newHistory, { role: 'jarvis', text: '' }]);
    setInput('');
    
    // Slight delay to make STT processing visible briefly
    setTimeout(async () => {
      setConversationState('PROCESSING_LLM');
      abortControllerRef.current = new AbortController();
      
      try {
        const foundVideo = checkKnowledgeBase(userText, videoRegistry);
        let modifiedHistory = newHistory;
        
        if (foundVideo) {
          modifiedHistory = [
            ...newHistory,
            { role: 'user', text: `SYSTEM INSTRUCTION: You are going to show the user a video titled "${foundVideo.title}". Write a very short 1-sentence introduction. Do not output the URL.` }
          ];
          pendingVideoUrlRef.current = foundVideo.url;
        } else {
          pendingVideoUrlRef.current = null;
        }

        let ragContext = null;
        try {
          const queryEmbedding = await generateEmbedding(userText, config);
          const res = await fetch('http://localhost:3000/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query_embedding: queryEmbedding })
          });
          if (res.ok) {
            ragContext = await res.json();
          }
        } catch(e) {
          console.error("RAG search error", e);
        }

        let fullResponse = '';
        let mediaArticleTriggered = null;

        await streamLLMResponse(modifiedHistory, config, (chunk) => {
          fullResponse += chunk;
          
          let textToRender = fullResponse;
          const mediaMatch = fullResponse.match(/\[MEDIA:(\d+)\]/);
          if (mediaMatch) {
             const articleId = parseInt(mediaMatch[1]);
             textToRender = fullResponse.replace(mediaMatch[0], ''); // Hide from UI
             if (ragContext) {
                const found = ragContext.find(a => a.id === articleId);
                if (found) mediaArticleTriggered = found;
             }
          }
          
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { 
              role: 'jarvis', 
              text: textToRender,
              videoUrl: foundVideo ? foundVideo.url : null,
              mediaArticle: mediaArticleTriggered
            };
            return updated;
          });
        }, abortControllerRef.current.signal, ragContext);
        
        if (mediaArticleTriggered) {
          setActiveArticle(mediaArticleTriggered);
        }
        
        // Wait for LLM to finish completely, THEN generate one continuous voice track
        if (fullResponse.trim().length > 0) {
          setPlayingMessageIndex(newHistory.length); // The index of the new jarvis message
          speakText(fullResponse);
        } else if (pendingVideoUrlRef.current) {
          // Fallback if LLM generated no text
          setActiveVideoUrl(pendingVideoUrlRef.current);
          setConversationState('PLAYING_VIDEO');
          pendingVideoUrlRef.current = null;
        }
        
      } catch (error) {
        setConversationState('IDLE');
        setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'jarvis', text: `System Error: ${error.message}` };
            return updated;
        });
        if (error.message.includes("missing")) {
           setShowSettings(true);
        }
      }
    }, 500); // 500ms fake STT delay for UX
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') handleSend();
  };

  const handleSpeedChange = (rate) => {
    setPlaybackRate(rate);
    setVoiceRate(rate);
  };

  const handleTogglePlayPause = () => {
    const state = togglePlayPause();
    if (state === 'paused') {
      setConversationState('AVATAR_PAUSED');
    } else if (state === 'playing') {
      setConversationState('AVATAR_SPEAKING');
    }
  };

  const handleReplay = (text, idx) => {
    stopSpeaking();
    setPlayingMessageIndex(idx);
    speakText(text);
  };

  const renderStatusBar = () => {
    switch (conversationState) {
      case 'IDLE': 
        return <div className="status-bar idle">Ready. Type or click the microphone to start.</div>;
      case 'USER_SPEAKING': 
        return <div className="status-bar active">Omid, your turn — start speaking. Click Send when done.</div>;
      case 'PROCESSING_STT': 
        return <div className="status-bar processing animate-pulse">Transcribing your speech...</div>;
      case 'PROCESSING_LLM': 
        return <div className="status-bar processing animate-pulse">Thinking...</div>;
      case 'PROCESSING_TTS': 
        return <div className="status-bar processing animate-pulse">Generating voice...</div>;
      case 'AVATAR_SPEAKING': 
        return <div className="status-bar active">Avatar is speaking...</div>;
      case 'AVATAR_PAUSED': 
        return <div className="status-bar paused">Avatar is paused.</div>;
      case 'PLAYING_VIDEO':
        return <div className="status-bar active">Playing Video...</div>;
      default: 
        return null;
    }
  };

  const isInputDisabled = conversationState !== 'IDLE' && conversationState !== 'USER_SPEAKING';
  const showInterrupt = conversationState === 'PROCESSING_LLM' || conversationState === 'PROCESSING_TTS' || conversationState === 'AVATAR_SPEAKING' || conversationState === 'AVATAR_PAUSED' || conversationState === 'PLAYING_VIDEO';

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar glass-panel">
        <div className="brand">
          <TerminalSquare size={32} color="var(--accent-primary)" />
          <h1>J.A.R.V.I.S.</h1>
        </div>
        
        <nav className="nav-links">
          <div className="nav-item active">
            <Activity size={20} />
            <span>Dashboard</span>
          </div>
          <div className="nav-item" onClick={() => setShowVideoLibrary(true)}>
            <i className="bi bi-camera-video"></i>
            <span>Video Library</span>
          </div>
          <div className="nav-item" onClick={() => setShowKnowledgeBase(true)}>
            <i className="bi bi-brain"></i>
            <span>Knowledge Base</span>
          </div>
          <div className="nav-item" onClick={() => setShowSettings(true)}>
            <Settings size={20} />
            <span>System Preferences</span>
          </div>
          <div className="nav-item">
            <Shield size={20} />
            <span>Security</span>
          </div>
        </nav>
        
        <div className="nav-item" style={{ marginTop: 'auto' }}>
          <Battery size={20} color="#2ed573" />
          <span>Core Power: 98%</span>
        </div>
      </aside>

      {/* Main Content (Split View) */}
      <main className="main-content" style={{ flexDirection: 'row', gap: '16px' }}>
        
        {/* Avatar Section */}
        <div className="avatar-section glass-panel" style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
           <div style={{ position: 'absolute', top: 24, left: 32, zIndex: 10 }}>
              <div className="brand" style={{ marginBottom: 0 }}>
                <h2 style={{fontSize: '1.2rem', margin: 0}}>AVATAR INTERFACE</h2>
              </div>
           </div>
           
           {conversationState === 'AVATAR_SPEAKING' && (
              <div style={{ position: 'absolute', top: 24, right: 32, color: '#2ed573', zIndex: 10, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="animate-pulse">Active</span>
                <Activity size={20} />
              </div>
           )}
           
           <div style={{ flex: 1, position: 'relative' }}>
             {conversationState === 'PLAYING_VIDEO' && activeVideoUrl && (
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, background: 'black', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <button 
                    onClick={() => {
                      setConversationState('IDLE');
                      setActiveVideoUrl(null);
                    }}
                    style={{ position: 'absolute', top: '16px', right: '16px', zIndex: 60, background: 'rgba(255, 255, 255, 0.2)', border: 'none', borderRadius: '50%', padding: '8px', cursor: 'pointer', color: 'white', display: 'flex' }}
                    title="Close Video"
                  >
                    <X size={24} />
                  </button>
                  {(() => {
                    const url = activeVideoUrl ? activeVideoUrl.trim() : '';
                    const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/);
                    const videoId = (match && match[2].length === 11) ? match[2] : null;
                    
                    if (!videoId) {
                      return <div style={{ color: '#ff4757', padding: '20px', background: 'rgba(0,0,0,0.8)', borderRadius: '8px' }}>Error: Invalid YouTube URL format.</div>;
                    }

                    return (
                      <iframe
                        width="100%"
                        height="100%"
                        src={`https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1`}
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        style={{ border: 'none', background: 'black' }}
                      />
                    );
                  })()}
                </div>
             )}
             <Canvas camera={{ position: [0, 0, 2], fov: 45 }}>
               <ambientLight intensity={1.5} />
               <directionalLight position={[2, 2, 2]} intensity={2} />
               <OrbitControls target={[0, -0.5, 0]} enabled={!isDraggingGizmo} />
               {avatarUrl ? (
                 <Suspense fallback={<Html center><div className="animate-pulse" style={{ color: 'var(--accent-primary)', whiteSpace: 'nowrap' }}>Loading Avatar...</div></Html>}>
                   <Avatar 
                     isSpeaking={conversationState === 'AVATAR_SPEAKING'} 
                     avatarUrl={avatarUrl} 
                     avatarExt={avatarExt} 
                     position={[avatarPos.x, avatarPos.y, 0]} 
                     gesture={showPoseEditor ? editingGesture : gesture} 
                     customGestures={showPoseEditor && draftGestures ? draftGestures : customGestures}
                     editingBone={showPoseEditor ? editingBone : null}
                     onGizmoDragStart={() => setIsDraggingGizmo(true)}
                     onGizmoDragEnd={() => setIsDraggingGizmo(false)}
                     onBoneRotate={handleBoneRotate}
                   />
                 </Suspense>
               ) : (
                 <Html center>
                   <div style={{ color: 'var(--text-secondary)', textAlign: 'center', width: '200px' }}>
                     <p>No Avatar Loaded</p>
                     <p style={{fontSize: '0.8rem', marginTop: '8px'}}>Please upload a .glb or .vrm file using the button below.</p>
                   </div>
                 </Html>
               )}
             </Canvas>
             
             {/* MEDIA CAROUSEL OVERLAY - In place of Avatar */}
             {activeArticle && (
               <MediaCarousel article={activeArticle} onClose={() => setActiveArticle(null)} />
             )}
           </div>

           <div style={{ position: 'absolute', bottom: 24, left: 32, zIndex: 10 }}>
             <input 
               type="file" 
               accept=".glb,.vrm" 
               ref={fileInputRef} 
               style={{ display: 'none' }} 
               onChange={handleFileUpload} 
             />
             <button className="glass-button" onClick={() => fileInputRef.current?.click()} style={{ padding: '8px 16px', fontSize: '0.85rem', background: 'rgba(0,0,0,0.4)' }}>
               <Upload size={16} /> Change Avatar
             </button>
             <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
               <select 
                 value={gesture} 
                 onChange={e => setGesture(e.target.value)}
                 style={{ background: 'rgba(0,0,0,0.6)', color: 'white', border: '1px solid rgba(255,255,255,0.2)', padding: '6px 12px', borderRadius: '4px', fontSize: '0.8rem', outline: 'none' }}
               >
                 <option value="idle">Gesture: Idle</option>
                 <option value="greeting">Gesture: Greeting</option>
                 <option value="thinking">Gesture: Thinking</option>
               </select>
               <button 
                 onClick={() => { 
                   setEditingGesture(gesture); 
                   setDraftGestures(JSON.parse(JSON.stringify(customGestures)));
                   setShowPoseEditor(true); 
                 }}
                 style={{ background: 'var(--accent-primary)', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer' }}
               >
                 Edit Pose
               </button>
             </div>
           </div>

           <div style={{ position: 'absolute', bottom: 24, right: 32, zIndex: 10, display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: '1px' }}>Up/Down</label>
                <input 
                  type="range" 
                  min="-3" max="3" step="0.1" 
                  value={avatarPos.y} 
                  onChange={(e) => setAvatarPos(prev => ({ ...prev, y: parseFloat(e.target.value) }))} 
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: '1px' }}>Left/Right</label>
                <input 
                  type="range" 
                  min="-3" max="3" step="0.1" 
                  value={avatarPos.x} 
                  onChange={(e) => setAvatarPos(prev => ({ ...prev, x: parseFloat(e.target.value) }))} 
                />
              </div>
           </div>
        </div>

        {/* Chat / Dashboard Section */}
        <div className="chat-section" style={{ flex: 1.2, display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* Header Widgets */}
          <div className="header glass-panel" style={{ padding: '20px' }}>
            <div className="widgets-container" style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
               <div className="widget" style={{ padding: '12px' }}>
                <div className="widget-icon"><Clock size={16} /></div>
                <div className="widget-info">
                  <h4>Time</h4>
                  <p style={{fontSize: '0.9rem'}}>{time}</p>
                </div>
              </div>
              <div className="widget" style={{ padding: '12px' }}>
                <div className="widget-icon"><Cloud size={16} /></div>
                <div className="widget-info">
                  <h4>Weather</h4>
                  <p style={{fontSize: '0.9rem'}}>72°F</p>
                </div>
              </div>
              <div className="widget" style={{ padding: '12px' }}>
                <div className="widget-icon"><Cpu size={16} /></div>
                <div className="widget-info">
                  <h4>Load</h4>
                  <p style={{fontSize: '0.9rem'}}>Stable</p>
                </div>
              </div>
            </div>
          </div>

          {/* Chat Interface */}
          <div className="chat-container glass-panel">
            {/* Status Bar */}
            <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)' }}>
              {renderStatusBar()}
            </div>
            
            <div className="chat-messages">
              {messages.map((msg, idx) => (
                <div key={idx} className={`message ${msg.role} animate-fade-in`} style={msg.text === '' ? {display: 'none'} : {}}>
                  <div className="avatar">
                    {msg.role === 'jarvis' ? <Activity size={20} /> : <User size={20} />}
                  </div>
                  <div className="message-content">
                    {msg.text}
                    {msg.role === 'jarvis' && msg.text && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: '8px', marginRight: 'auto' }}>
                          {msg.videoUrl && (
                            <button 
                              className="glass-button" 
                              style={{ 
                                padding: '4px 12px', 
                                fontSize: '0.8rem', 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '6px',
                                background: 'var(--accent-primary)',
                                color: 'white',
                                border: 'none'
                              }}
                              onClick={() => {
                                setActiveVideoUrl(msg.videoUrl);
                                setConversationState('PLAYING_VIDEO');
                              }}
                              title="Replay Video"
                            >
                              <Play size={14} /> Watch Video
                            </button>
                          )}
                          {msg.mediaArticle && (
                            <button 
                              className="glass-button" 
                              style={{ 
                                padding: '4px 12px', 
                                fontSize: '0.8rem', 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '6px',
                                background: '#3498db',
                                color: 'white',
                                border: 'none'
                              }}
                              onClick={() => {
                                setActiveArticle(msg.mediaArticle);
                              }}
                              title="View Gallery"
                            >
                              <i className="bi bi-images" style={{ fontSize: '14px' }}></i> View Gallery
                            </button>
                          )}
                        </div>
                        <select 
                          value={playbackRate} 
                          onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                          style={{ 
                            background: 'rgba(0,0,0,0.3)', 
                            color: 'var(--text-primary)', 
                            border: '1px solid rgba(255,255,255,0.1)', 
                            borderRadius: '6px', 
                            padding: '4px 8px', 
                            fontSize: '0.8rem', 
                            outline: 'none',
                            cursor: 'pointer'
                          }}
                        >
                          <option value={1}>1x Speed</option>
                          <option value={1.25}>1.25x Speed</option>
                          <option value={1.5}>1.5x Speed</option>
                          <option value={2}>2x Speed</option>
                        </select>
                        
                        {playingMessageIndex === idx && conversationState === 'AVATAR_SPEAKING' ? (
                          <button 
                            onClick={handleTogglePlayPause} 
                            title="Pause" 
                            style={{ background: 'var(--accent-primary)', border: 'none', color: '#fff', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 0 10px rgba(0, 210, 211, 0.4)' }}
                          >
                            <Pause size={14} fill="currentColor" />
                          </button>
                        ) : playingMessageIndex === idx && conversationState === 'AVATAR_PAUSED' ? (
                          <button 
                            onClick={handleTogglePlayPause} 
                            title="Resume" 
                            style={{ background: 'var(--accent-primary)', border: 'none', color: '#fff', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 0 10px rgba(0, 210, 211, 0.4)' }}
                          >
                            <Play size={14} fill="currentColor" style={{ marginLeft: '2px' }} />
                          </button>
                        ) : (
                          <button 
                            onClick={() => handleReplay(msg.text, idx)} 
                            title="Replay" 
                            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: 'var(--text-secondary)', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.2s' }}
                            onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.2)'; e.currentTarget.style.color = '#fff'; }}
                            onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                          >
                            <RotateCcw size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="message-actions" style={{ display: 'flex', alignItems: 'center', opacity: 0.5, cursor: 'pointer' }}>
                    <button 
                      className="glass-button" 
                      style={{ padding: '6px', border: 'none', background: 'transparent' }}
                      onClick={() => navigator.clipboard.writeText(msg.text)}
                      title="Copy message"
                    >
                      <Copy size={14} color="white" />
                    </button>
                  </div>
                </div>
              ))}
              
              {conversationState === 'PROCESSING_LLM' && (
                 <div className="message jarvis animate-fade-in">
                   <div className="avatar"><Activity size={20} /></div>
                   <div className="message-content">
                     <div className="typing-indicator">
                       <div className="typing-dot"></div>
                       <div className="typing-dot"></div>
                       <div className="typing-dot"></div>
                     </div>
                   </div>
                 </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
            
            <div className="chat-input-area">
              <div className="input-wrapper">
                <input 
                  type="text" 
                  className="glass-input" 
                  placeholder="Type your message..." 
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  disabled={isInputDisabled}
                />
                {conversationState === 'IDLE' && (
                  <button 
                    className="voice-btn"
                    onClick={toggleListen}
                    title="Start Voice Input"
                  >
                    <Mic size={20} />
                  </button>
                )}
              </div>
              
              {conversationState === 'USER_SPEAKING' ? (
                <button className="glass-button primary" onClick={handleSend} style={{ backgroundColor: '#ff9f43' }}>
                  <Send size={20} style={{ marginRight: '8px' }}/> Send
                </button>
              ) : showInterrupt ? (
                <button className="glass-button primary" onClick={handleInterrupt} style={{ backgroundColor: '#ff4757' }}>
                  <Square size={20} style={{ marginRight: '8px' }}/> Interrupt
                </button>
              ) : (
                <button className="glass-button primary" onClick={handleSend} disabled={isInputDisabled}>
                  <Send size={20} />
                </button>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>System Preferences</h3>
              <button className="close-btn" onClick={() => setShowSettings(false)}>
                <X size={24} />
              </button>
            </div>
            
            <div className="form-group">
              <label>AI Provider</label>
              <select 
                value={config.provider}
                onChange={e => setConfig({...config, provider: e.target.value})}
              >
                <option value="gemini">Google Gemini</option>
                <option value="openai">OpenAI (GPT)</option>
                <option value="ollama">Local Ollama</option>
              </select>
            </div>

            {config.provider === 'gemini' && (
              <div className="form-group animate-fade-in">
                <label>Gemini API Key</label>
                <input 
                  type="password" 
                  className="glass-input" 
                  value={config.geminiKey}
                  onChange={e => setConfig({...config, geminiKey: e.target.value})}
                  placeholder="AIzaSy..."
                />
              </div>
            )}

            {config.provider === 'openai' && (
              <div className="form-group animate-fade-in">
                <label>OpenAI API Key</label>
                <input 
                  type="password" 
                  className="glass-input" 
                  value={config.openaiKey}
                  onChange={e => setConfig({...config, openaiKey: e.target.value})}
                  placeholder="sk-..."
                />
              </div>
            )}

            {config.provider === 'ollama' && (
              <>
                <div className="form-group animate-fade-in">
                  <label>Ollama URL (Must enable CORS for this port)</label>
                  <input 
                    type="text" 
                    className="glass-input" 
                    value={config.ollamaUrl}
                    onChange={e => setConfig({...config, ollamaUrl: e.target.value})}
                    placeholder="http://localhost:11434"
                  />
                </div>
                <div className="form-group animate-fade-in">
                  <label>Ollama Model Name</label>
                  <input 
                    type="text" 
                    className="glass-input" 
                    value={config.ollamaModel}
                    onChange={e => setConfig({...config, ollamaModel: e.target.value})}
                    placeholder="llama3"
                  />
                </div>
              </>
            )}
            
            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="glass-button primary" onClick={() => setShowSettings(false)}>
                Save Preferences
              </button>
            </div>
          </div>
        </div>
      )}

      {/* KNOWLEDGE BASE OVERLAY */}
      {showKnowledgeBase && (
        <div className="modal-overlay" onClick={() => setShowKnowledgeBase(false)}>
          <div className="modal-content" style={{ width: '90%', maxWidth: '800px', height: '85vh', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Knowledge Base (RAG)</h3>
                <p style={{ opacity: 0.6, fontSize: '0.9rem', margin: '4px 0 0 0' }}>Add articles, documents, and media to Jarvis's brain.</p>
              </div>
              <button className="close-btn" onClick={() => setShowKnowledgeBase(false)}>
                <i className="bi bi-x-lg" style={{ fontSize: '1.5rem' }}></i>
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', paddingRight: '10px' }}>
              <KnowledgeBase config={config} />
            </div>
          </div>
        </div>
      )}

      {/* Video Library Modal */}
      {showVideoLibrary && (() => {
        const handleSaveVideo = () => {
          if (!editingVideo.url || !editingVideo.title) return alert("Title and URL are required.");
          const tagsArray = typeof editingVideo.tags === 'string' ? editingVideo.tags.split(',').map(t => t.trim()).filter(Boolean) : editingVideo.tags;
          
          if (videoLibraryView === 'add') {
            setVideoRegistry([...videoRegistry, { ...editingVideo, id: Date.now().toString(), tags: tagsArray }]);
          } else {
            setVideoRegistry(videoRegistry.map(v => v.id === editingVideo.id ? { ...editingVideo, tags: tagsArray } : v));
          }
          setVideoLibraryView('list');
        };

        const deleteVideo = (id) => {
          if (window.confirm('Delete this video?')) {
            setVideoRegistry(videoRegistry.filter(v => v.id !== id));
          }
        };

        return (
          <div className="modal-overlay" onClick={() => setShowVideoLibrary(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px', width: '90%' }}>
              <div className="modal-header">
                <h3>Video Library</h3>
                <button className="close-btn" onClick={() => setShowVideoLibrary(false)}>
                  <X size={24} />
                </button>
              </div>

              {videoLibraryView === 'list' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
                    <button className="glass-button primary" onClick={() => { setEditingVideo({ id: '', title: '', url: '', description: '', tags: '' }); setVideoLibraryView('add'); }}>
                      <Plus size={16} style={{ marginRight: '8px' }} /> Add Video
                    </button>
                  </div>
                  
                  {videoRegistry.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '40px 0' }}>
                      <Video size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
                      <p>No videos in library.</p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '60vh', overflowY: 'auto' }}>
                      {videoRegistry.map(video => (
                        <div key={video.id} style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <h4 style={{ margin: '0 0 4px 0' }}>{video.title}</h4>
                            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{video.description}</p>
                            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                              {video.tags.map(t => (
                                <span key={t} style={{ background: 'var(--accent-primary)', color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem' }}>{t}</span>
                              ))}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button className="glass-button" style={{ padding: '6px' }} onClick={() => { setEditingVideo({ ...video, tags: video.tags.join(', ') }); setVideoLibraryView('edit'); }}>
                              <Edit2 size={16} />
                            </button>
                            <button className="glass-button" style={{ padding: '6px', color: '#ff4757' }} onClick={() => deleteVideo(video.id)}>
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(videoLibraryView === 'add' || videoLibraryView === 'edit') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div className="form-group">
                    <label>Video Title</label>
                    <input className="glass-input" value={editingVideo.title} onChange={e => setEditingVideo({...editingVideo, title: e.target.value})} placeholder="e.g. Solar Panel Reset" />
                  </div>
                  <div className="form-group">
                    <label>YouTube URL</label>
                    <input className="glass-input" value={editingVideo.url} onChange={e => setEditingVideo({...editingVideo, url: e.target.value})} placeholder="https://www.youtube.com/watch?v=..." />
                  </div>
                  <div className="form-group">
                    <label>Description</label>
                    <textarea className="glass-input" value={editingVideo.description} onChange={e => setEditingVideo({...editingVideo, description: e.target.value})} placeholder="Short description for RAG context..." style={{ minHeight: '80px', resize: 'vertical', color: 'white' }} />
                  </div>
                  <div className="form-group">
                    <label>Tags (comma separated)</label>
                    <input className="glass-input" value={editingVideo.tags} onChange={e => setEditingVideo({...editingVideo, tags: e.target.value})} placeholder="solar, fix, tutorial" />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
                    <button className="glass-button" onClick={() => setVideoLibraryView('list')}>Cancel</button>
                    <button className="glass-button primary" onClick={handleSaveVideo}>Save Video</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Pose Editor Modal */}
      {showPoseEditor && (() => {
        const handleBoneChange = (bone, axis, value) => {
          setDraftGestures(prev => ({
            ...prev,
            [editingGesture]: {
              ...(prev[editingGesture] || {}),
              [bone]: {
                ...((prev[editingGesture] || {})[bone] || { x: 0, y: 0, z: 0 }),
                [axis]: parseFloat(value)
              }
            }
          }));
        };

        const getBoneVal = (bone, axis) => {
          return draftGestures?.[editingGesture]?.[bone]?.[axis] || 0;
        };
        
        const resetToDefault = () => {
          setDraftGestures(prev => {
            const copy = { ...prev };
            delete copy[editingGesture];
            return copy;
          });
        };

        const handleCancel = () => {
          if (JSON.stringify(draftGestures) !== JSON.stringify(customGestures)) {
            if (!window.confirm("You have unsaved changes. Are you sure you want to cancel?")) {
              return;
            }
          }
          setShowPoseEditor(false);
          setDraftGestures(null);
          setEditingBone(null);
        };

        const handleSave = () => {
          setCustomGestures(draftGestures);
          setShowPoseEditor(false);
          setDraftGestures(null);
          setEditingBone(null);
        };

        const renderBoneSliders = (title, bone) => (
          <div style={{ marginBottom: '16px', background: editingBone === bone ? 'rgba(0, 150, 255, 0.2)' : 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', border: editingBone === bone ? '1px solid var(--accent-primary)' : '1px solid transparent' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h4 style={{ margin: 0, fontSize: '0.9rem', color: editingBone === bone ? 'var(--accent-primary)' : 'white' }}>{title}</h4>
              <button 
                onClick={() => setEditingBone(editingBone === bone ? null : bone)}
                style={{ padding: '4px 8px', fontSize: '0.75rem', background: editingBone === bone ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)', color: editingBone === bone ? 'black' : 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                {editingBone === bone ? "Close 3D Gizmo" : "Edit in 3D"}
              </button>
            </div>
            {['x', 'y', 'z'].map(axis => (
              <div key={axis} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ width: '20px', fontSize: '0.8rem', textTransform: 'uppercase' }}>{axis}</span>
                <input 
                  type="range" min="-3.14" max="3.14" step="0.01" 
                  value={getBoneVal(bone, axis)} 
                  onChange={e => handleBoneChange(bone, axis, e.target.value)}
                  style={{ flex: 1 }}
                />
                <span style={{ width: '40px', fontSize: '0.8rem', textAlign: 'right' }}>{getBoneVal(bone, axis).toFixed(2)}</span>
              </div>
            ))}
          </div>
        );

        return (
          <div className="modal-overlay" style={{ backdropFilter: 'none', background: 'rgba(0,0,0,0.1)' }}>
            <div className="modal-content" style={{ maxWidth: '400px', right: '40px', top: '40px', left: 'auto', transform: 'none', position: 'absolute', maxHeight: 'calc(100vh - 80px)', overflowY: 'auto' }}>
              <div className="modal-header" style={{ position: 'sticky', top: 0, background: 'var(--bg-panel)', zIndex: 10, paddingBottom: '12px' }}>
                <h3>Pose Editor</h3>
                <button className="close-btn" onClick={handleCancel}>
                  <X size={24} />
                </button>
              </div>
              
              <div className="form-group" style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ flex: 1, minWidth: '120px' }}>
                  <label>Editing Gesture</label>
                  <select 
                    value={editingGesture}
                    onChange={e => setEditingGesture(e.target.value)}
                    className="glass-input"
                  >
                    <option value="idle">Idle</option>
                    <option value="greeting">Greeting</option>
                    <option value="thinking">Thinking</option>
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: '120px' }}>
                  <label>Apply Preset</label>
                  <select 
                    onChange={e => {
                      if (!e.target.value) return;
                      const POSE_PRESETS = {
                        'Handshake': {
                          rightUpperArm: { x: -0.5, y: -0.2, z: -1.0 },
                          rightLowerArm: { x: -1.2, y: -0.5, z: 0 },
                          leftUpperArm: { x: 0, y: 0, z: -1.2 },
                          leftLowerArm: { x: -0.2, y: 0, z: 0 }
                        },
                        'Thinking': {
                          rightUpperArm: { x: -0.2, y: 0, z: -1.0 },
                          rightLowerArm: { x: -2.4, y: 0.3, z: 0 },
                          leftUpperArm: { x: 0, y: 0, z: -1.2 },
                          leftLowerArm: { x: -0.2, y: 0, z: 0 }
                        },
                        'Crossed Arms': {
                          rightUpperArm: { x: -0.8, y: -0.5, z: -1.0 },
                          rightLowerArm: { x: -1.8, y: -0.5, z: 0 },
                          leftUpperArm: { x: -0.8, y: 0.5, z: 1.0 },
                          leftLowerArm: { x: -1.8, y: 0.5, z: 0 }
                        }
                      };
                      const preset = POSE_PRESETS[e.target.value];
                      if (preset) {
                        setDraftGestures(prev => ({
                          ...prev,
                          [editingGesture]: JSON.parse(JSON.stringify(preset))
                        }));
                      }
                      e.target.value = "";
                    }}
                    className="glass-input"
                    defaultValue=""
                  >
                    <option value="" disabled>Select Preset...</option>
                    <option value="Handshake">Handshake</option>
                    <option value="Thinking">Thinking</option>
                    <option value="Crossed Arms">Crossed Arms</option>
                  </select>
                </div>
                <button onClick={resetToDefault} style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', height: '36px' }}>
                  Reset
                </button>
              </div>

              {renderBoneSliders("Left Upper Arm", "leftUpperArm")}
              {renderBoneSliders("Right Upper Arm", "rightUpperArm")}
              {renderBoneSliders("Left Lower Arm", "leftLowerArm")}
              {renderBoneSliders("Right Lower Arm", "rightLowerArm")}
              
              <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '12px', position: 'sticky', bottom: 0, background: 'var(--bg-panel)', paddingTop: '12px' }}>
                <button className="glass-button" onClick={handleCancel} style={{ background: 'rgba(255,255,255,0.1)' }}>
                  Cancel
                </button>
                <button className="glass-button primary" onClick={handleSave}>
                  Save Pose
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default App;
