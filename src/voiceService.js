let globalAudio = null;
let speechQueue = [];
let isPlaying = false;
let isPaused = false;
let globalPlaybackRate = 1.0;
const audioCache = {};

let globalOnStart = null;
let globalOnEnd = null;
let globalOnFetchStart = null;
let abortController = null;

let useBrowserTts = true; // Default to true (Option 3), toggleable via settings
let audioContext = null;
let analyser = null;
let sourceNode = null;

// The global callback to pass lipsync data to the Avatar
export let onLipsyncData = null;

export function setUseBrowserTts(val) {
  useBrowserTts = val;
}

export function getAudioVolumeAnalyser() {
  if (!globalAudio) return null;
  
  if (!audioContext) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioContextClass();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      
      sourceNode = audioContext.createMediaElementSource(globalAudio);
      sourceNode.connect(analyser);
      analyser.connect(audioContext.destination);
    } catch (e) {
      console.error("Failed to initialize Web Audio Analyser:", e);
    }
  }
  
  // Resume context if suspended (browser security restriction on autoplay)
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
  
  return analyser;
}

export function initVoice(onStart, onEnd, onFetchStart) {
  globalOnStart = onStart;
  globalOnEnd = onEnd;
  globalOnFetchStart = onFetchStart;
}

export function preInitializeVoice() {
  if (!globalAudio) {
    globalAudio = new Audio();
    // This allows the browser to authorize audio playback on a user gesture
    globalAudio.play().catch(() => {});
    globalAudio.pause();
  }
}

export function setLipsyncCallback(cb) {
  onLipsyncData = cb;
}

export function setPlaybackRate(rate) {
  globalPlaybackRate = rate;
  if (globalAudio) {
    globalAudio.playbackRate = rate;
  }
}

export function togglePlayPause() {
  if (useBrowserTts) {
    if (window.speechSynthesis) {
      if (isPlaying && !isPaused) {
        window.speechSynthesis.pause();
        isPaused = true;
        return 'paused';
      } else if (isPlaying && isPaused) {
        window.speechSynthesis.resume();
        isPaused = false;
        return 'playing';
      }
    }
    return 'stopped';
  }

  if (!globalAudio) return 'stopped';
  
  if (isPlaying && !isPaused) {
    globalAudio.pause();
    isPaused = true;
    return 'paused';
  } else if (isPlaying && isPaused) {
    globalAudio.play().catch(e => console.error("Resume error:", e));
    isPaused = false;
    return 'playing';
  }
  return 'stopped';
}

function playData(data) {
  if (!globalAudio) {
    globalAudio = new Audio();
  }
  
  globalAudio.onended = () => {
    isPlaying = false;
    isPaused = false;
    if (onLipsyncData) onLipsyncData(null, null); // Clear lipsync
    if (speechQueue.length > 0) {
      processQueue();
    } else {
      if (globalOnEnd) globalOnEnd(); // Tell UI we are done speaking
    }
  };
  
  globalAudio.onerror = (e) => {
    console.error("Audio TTS Error:", e);
    isPlaying = false;
    isPaused = false;
    if (speechQueue.length > 0) processQueue();
    else if (globalOnEnd) globalOnEnd();
  };
  
  // Pass the new lipsync data and audio to the Avatar
  if (onLipsyncData) onLipsyncData(data.lipsync, globalAudio);
  
  globalAudio.src = "data:audio/wav;base64," + data.audio;
  globalAudio.playbackRate = globalPlaybackRate;
  
  if (globalOnStart) globalOnStart(); // Tell UI we started playing audio
  
  globalAudio.play().catch(e => {
      console.error("Autoplay blocked or error:", e);
      globalAudio.onended();
  });
}

function processQueue() {
  if (isPlaying || speechQueue.length === 0) return;
  
  isPlaying = true;
  isPaused = false;
  
  const text = speechQueue.shift();
  
  if (useBrowserTts) {
    if (globalOnStart) globalOnStart(); // Tell UI we started speaking
    
    // Create SpeechSynthesisUtterance
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Attempt to set a high quality voice based on system availability
    const voices = window.speechSynthesis.getVoices();
    const preferredLang = localStorage.getItem('jarvis_speech_lang') || 'it-IT';
    
    // Try to find a voice that matches preferredLang
    let preferredVoice = voices.find(v => v.lang.toLowerCase().startsWith(preferredLang.toLowerCase().split('-')[0]));
    
    // Fallback if no matching voice is found
    if (!preferredVoice) {
      preferredVoice = voices.find(v => v.lang.startsWith('it')) || voices.find(v => v.lang.startsWith('en'));
    }
    
    if (preferredVoice) {
      utterance.voice = preferredVoice;
      utterance.lang = preferredVoice.lang;
    }
    
    utterance.rate = globalPlaybackRate;
    
    utterance.onend = () => {
      isPlaying = false;
      isPaused = false;
      if (onLipsyncData) onLipsyncData(null, null); // Clear lipsync
      if (speechQueue.length > 0) {
        processQueue();
      } else {
        if (globalOnEnd) globalOnEnd(); // Tell UI we are done speaking
      }
    };
    
    utterance.onerror = (e) => {
      console.error("SpeechSynthesis Error:", e);
      isPlaying = false;
      isPaused = false;
      if (speechQueue.length > 0) processQueue();
      else if (globalOnEnd) globalOnEnd();
    };
    
    // Call the lipsync callback with null cues to let Avatar know it is playing via browser TTS
    if (onLipsyncData) onLipsyncData(null, null);
    
    window.speechSynthesis.speak(utterance);
    return;
  }
  
  // Instant replay if we have the TTS cached
  if (audioCache[text]) {
    playData(audioCache[text]);
    return;
  }
  
  if (globalOnFetchStart) globalOnFetchStart(); // Tell UI we are fetching TTS
  
  const preferredLang = localStorage.getItem('jarvis_speech_lang') || 'it-IT';
  const url = `/tts?q=${encodeURIComponent(text)}&lang=${preferredLang.split('-')[0]}`;
  abortController = new AbortController();
  
  fetch(url, { signal: abortController.signal })
    .then(res => res.json())
    .then(data => {
      if (!data.audio || !data.lipsync) throw new Error("Invalid backend response");
      
      audioCache[text] = data; // Cache for immediate replay later
      playData(data);
    })
    .catch(e => {
      if (e.name === 'AbortError') {
        console.log('TTS fetch aborted');
        return; // Interrupted, do nothing else
      }
      console.error("TTS Fetch Error:", e);
      isPlaying = false;
      isPaused = false;
      if (speechQueue.length > 0) processQueue();
      else if (globalOnEnd) globalOnEnd();
    });
}

export function speakText(text) {
  if (!text.trim()) return;
  
  // Push the entire text as a single item to avoid playback gaps.
  speechQueue.push(text.trim());
  
  processQueue();
}

export function stopSpeaking() {
  if (globalAudio) {
    globalAudio.pause();
    globalAudio.currentTime = 0;
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  speechQueue = [];
  isPlaying = false;
  isPaused = false;
  if (onLipsyncData) onLipsyncData(null, null);
}

export function interruptSpeaking() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  stopSpeaking();
  if (globalOnEnd) globalOnEnd(); // Force UI back to IDLE
}
