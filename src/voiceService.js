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

// The global callback to pass lipsync data to the Avatar
export let onLipsyncData = null;

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
  
  // Instant replay if we have the TTS cached
  if (audioCache[text]) {
    playData(audioCache[text]);
    return;
  }
  
  if (globalOnFetchStart) globalOnFetchStart(); // Tell UI we are fetching TTS
  
  const url = `/tts?q=${encodeURIComponent(text)}`;
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
