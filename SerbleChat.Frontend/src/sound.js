/**
 * Sound utility module for playing UI sounds
 */

const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// Detect if running in Electron
const isElectron = () => {
  return typeof window !== 'undefined' && window.electron !== undefined;
};

// Get the correct base path for sound files
function getSoundBasePath() {
  const protocol = window.location.protocol;
  const isElectronApp = isElectron();
  
  console.log(`[Sound Init] Protocol: ${protocol}, isElectron: ${isElectronApp}`);
  console.log(`[Sound Init] Location href: ${window.location.href}`);
  
  // In Electron production, files are served from file:// protocol
  if (isElectronApp && protocol === 'file:') {
    // When loaded via file://, we need to construct the path relative to index.html
    // The sounds folder is in the same directory as index.html
    const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
    const soundsPath = `${baseUrl}/sounds`;
    console.log('[Sound Init] Using absolute file:// path for Electron production:', soundsPath);
    return soundsPath;
  }
  
  // For Electron development (http://localhost) or web deployment
  console.log('[Sound Init] Using absolute path for web/dev mode');
  return '/sounds';
}

const basePath = getSoundBasePath();

console.log(`[Sound] Initialized with base path: ${basePath}`);

// Map of sound names to their file paths
const SOUND_FILES = {
  notification: `${basePath}/notification.ogg`,
  mute: `${basePath}/mute.ogg`,
  unmute: `${basePath}/unmute.ogg`,
  deafen: `${basePath}/deafen.ogg`,
  undeafen: `${basePath}/undeafen.ogg`,
  join: `${basePath}/join.ogg`,
  leave: `${basePath}/leave.ogg`,
  stream_start: `${basePath}/stream_start.ogg`,
  stream_end: `${basePath}/stream_end.ogg`,
};

// Cache for decoded audio buffers
const audioBufferCache = {};

/**
 * Load and cache an audio file
 * @param {string} soundName - The name of the sound (key in SOUND_FILES)
 * @returns {Promise<AudioBuffer>}
 */
async function loadAudioBuffer(soundName) {
  if (audioBufferCache[soundName]) {
    return audioBufferCache[soundName];
  }

  const filePath = SOUND_FILES[soundName];
  if (!filePath) {
    throw new Error(`Sound "${soundName}" not found`);
  }

  try {
    console.log(`[Sound] Loading sound "${soundName}" from path: ${filePath}`);
    console.log(`[Sound] Window location: ${window.location.href}`);
    console.log(`[Sound] Protocol: ${window.location.protocol}`);
    
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${filePath}: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    audioBufferCache[soundName] = audioBuffer;
    console.log(`[Sound] Successfully loaded sound "${soundName}"`);
    return audioBuffer;
  } catch (error) {
    console.error(`[Sound] Failed to load sound "${soundName}" from ${filePath}:`, error);
    console.error(`[Sound] Base path: ${basePath}, Full path attempted: ${filePath}`);
    throw error;
  }
}

/**
 * Play a sound
 * @param {string} soundName - The name of the sound to play
 * @param {number} [volume=1] - The volume level (0-1)
 * @returns {Promise<void>}
 */
export async function playSound(soundName, volume = 1) {
  try {
    // Resume audio context if suspended (required by some browsers)
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const audioBuffer = await loadAudioBuffer(soundName);
    const source = audioContext.createBufferSource();
    const gainNode = audioContext.createGain();

    source.buffer = audioBuffer;
    gainNode.gain.value = Math.max(0, Math.min(1, volume)); // Clamp volume between 0 and 1

    source.connect(gainNode);
    gainNode.connect(audioContext.destination);

    source.start(0);
  } catch (error) {
    console.error(`Failed to play sound "${soundName}":`, error);
  }
}

/**
 * Preload multiple sounds for faster playback
 * @param {string[]} soundNames - Array of sound names to preload
 * @returns {Promise<void>}
 */
export async function preloadSounds(soundNames) {
  try {
    await Promise.all(soundNames.map(name => loadAudioBuffer(name)));
  } catch (error) {
    console.error('Failed to preload sounds:', error);
  }
}

/**
 * Check if a sound exists
 * @param {string} soundName - The name of the sound to check
 * @returns {boolean}
 */
export function soundExists(soundName) {
  return soundName in SOUND_FILES;
}

/**
 * Get the path for a sound file
 * @param {string} soundName - The name of the sound
 * @returns {string|null}
 */
export function getSoundPath(soundName) {
  return SOUND_FILES[soundName] ?? null;
}
