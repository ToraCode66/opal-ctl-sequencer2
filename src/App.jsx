import React, { useState, useEffect, useRef, useCallback } from 'react';

// --- Constants & Defaults ---
const NUM_TRACKS = 8;
const STEPS_PER_PAGE = 16;
const MAX_STEPS = 128;
const NUM_PAGES = MAX_STEPS / STEPS_PER_PAGE;
const LOOKAHEAD = 25.0; // ms
const SCHEDULE_AHEAD_TIME = 0.1; // seconds
const LINK_QUANTUM = 4; // 4 beats per bar for Ableton Link phase alignment

const TRACK_COLORS = [
  { name: 'Cyan', hex: '#22d3ee', rgb: '34, 211, 238' },
  { name: 'Mint', hex: '#34d399', rgb: '52, 211, 153' },
  { name: 'Amber', hex: '#fbbf24', rgb: '251, 191, 36' },
  { name: 'Coral', hex: '#fb7185', rgb: '251, 113, 133' },
  { name: 'Lilac', hex: '#a78bfa', rgb: '167, 139, 250' },
  { name: 'Ice', hex: '#38bdf8', rgb: '56, 189, 248' },
  { name: 'Acid', hex: '#a3e635', rgb: '163, 230, 53' },
  { name: 'Tangerine', hex: '#fb923c', rgb: '251, 146, 60' }
];

const DEFAULT_CC_CONFIGS = [
  { cc: 74, defaultValue: 64 }, // Cutoff
  { cc: 71, defaultValue: 0 },  // Resonance
  { cc: 73, defaultValue: 10 }, // Attack
  { cc: 72, defaultValue: 40 }  // Release
];

const DEFAULT_TRACKS = Array.from({ length: NUM_TRACKS }, (_, i) => ({
  id: i,
  name: `T${i + 1}`,
  color: TRACK_COLORS[i % TRACK_COLORS.length],
  channel: i, // 0-indexed MIDI channel
  note: 36 + i, // C1 upwards
  length: 16,
  division: 0.25, // 1/16th note (in beats)
  ccConfigs: DEFAULT_CC_CONFIGS.map(cfg => ({ ...cfg })),
  steps: Array.from({ length: MAX_STEPS }, () => ({
    active: false,
    pitch: 0, // -24 to +24 semitones offset from track base note
    velocity: 100,
    probability: 100,
    ratchet: 1,
    ccLocks: [null, null, null, null] // null = use track default, 0-127 = locked step value
  }))
}));

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const formatNote = (midiNote) => {
  const clamped = Math.max(0, Math.min(127, midiNote));
  const octave = Math.floor(clamped / 12) - 1;
  const noteName = NOTE_NAMES[clamped % 12];
  return `${noteName}${octave}`;
};

const getInvertedHex = (hex) => {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  const r = 255 - ((num >> 16) & 255);
  const g = 255 - ((num >> 8) & 255);
  const b = 255 - (num & 255);
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
};

const hexToRgbString = (hex) => {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '34, 211, 238';
  const num = parseInt(clean, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `${r}, ${g}, ${b}`;
};

const cloneSteps = (steps) =>
  steps.map(step => ({
    ...step,
    ccLocks: step.ccLocks ? [...step.ccLocks] : [null, null, null, null]
  }));

const cloneTrack = (track) => ({
  ...track,
  color: { ...track.color },
  ccConfigs: track.ccConfigs.map(cfg => ({ ...cfg })),
  steps: cloneSteps(track.steps)
});

// --- Pixel-Art Icons (Crisp 1-bit Grid) ---
const PixelPlayIcon = ({ className = "w-2.5 h-2.5" }) => (
  <svg viewBox="0 0 8 8" shapeRendering="crispEdges" className={`${className} fill-current`}>
    <rect x="1" y="1" width="1" height="6" />
    <rect x="2" y="1" width="1" height="6" />
    <rect x="3" y="2" width="1" height="4" />
    <rect x="4" y="2" width="1" height="4" />
    <rect x="5" y="3" width="1" height="2" />
    <rect x="6" y="3" width="1" height="2" />
  </svg>
);

const PixelStopIcon = ({ className = "w-2.5 h-2.5" }) => (
  <svg viewBox="0 0 8 8" shapeRendering="crispEdges" className={`${className} fill-current`}>
    <rect x="1" y="1" width="6" height="6" />
  </svg>
);

const PixelGearIcon = ({ className = "w-2.5 h-2.5" }) => (
  <svg viewBox="0 0 8 8" shapeRendering="crispEdges" className={`${className} fill-current`}>
    <rect x="3" y="0" width="2" height="1" />
    <rect x="3" y="7" width="2" height="1" />
    <rect x="0" y="3" width="1" height="2" />
    <rect x="7" y="3" width="1" height="2" />
    <rect x="1" y="1" width="1" height="1" />
    <rect x="6" y="1" width="1" height="1" />
    <rect x="1" y="6" width="1" height="1" />
    <rect x="6" y="6" width="1" height="1" />
    <rect x="2" y="2" width="4" height="1" />
    <rect x="2" y="5" width="4" height="1" />
    <rect x="2" y="3" width="1" height="2" />
    <rect x="5" y="3" width="1" height="2" />
  </svg>
);

const DiceIcon = ({ className = "w-2.5 h-2.5" }) => (
  <svg viewBox="0 0 9 9" shapeRendering="crispEdges" className={`${className} fill-current`}>
    <rect x="1" y="0" width="7" height="1" />
    <rect x="1" y="8" width="7" height="1" />
    <rect x="0" y="1" width="1" height="7" />
    <rect x="8" y="1" width="1" height="7" />
    <rect x="2" y="2" width="1" height="1" />
    <rect x="6" y="2" width="1" height="1" />
    <rect x="4" y="4" width="1" height="1" />
    <rect x="2" y="6" width="1" height="1" />
    <rect x="6" y="6" width="1" height="1" />
  </svg>
);

const StepLockIcon = ({ type }) => {
  switch (type) {
    case 'pitch':
      return (
        <svg viewBox="0 0 9 9" shapeRendering="crispEdges" className="w-3.5 h-3.5 fill-current">
          <rect x="3" y="1" width="5" height="1" />
          <rect x="3" y="2" width="1" height="5" />
          <rect x="7" y="2" width="1" height="4" />
          <rect x="1" y="6" width="3" height="2" />
          <rect x="5" y="5" width="3" height="2" />
        </svg>
      );
    case 'velocity':
      return (
        <svg viewBox="0 0 9 9" shapeRendering="crispEdges" className="w-3.5 h-3.5 fill-current">
          <rect x="1" y="6" width="1" height="2" />
          <rect x="3" y="4" width="1" height="4" />
          <rect x="5" y="2" width="1" height="6" />
          <rect x="7" y="1" width="1" height="7" />
        </svg>
      );
    case 'probability':
      return (
        <svg viewBox="0 0 9 9" shapeRendering="crispEdges" className="w-3.5 h-3.5 fill-current">
          <rect x="1" y="1" width="2" height="2" />
          <rect x="6" y="6" width="2" height="2" />
          <rect x="6" y="1" width="1" height="1" />
          <rect x="5" y="2" width="1" height="2" />
          <rect x="4" y="4" width="1" height="1" />
          <rect x="3" y="5" width="1" height="2" />
          <rect x="2" y="7" width="1" height="1" />
        </svg>
      );
    case 'ratchet':
      return (
        <svg viewBox="0 0 9 9" shapeRendering="crispEdges" className="w-3.5 h-3.5 fill-current">
          <rect x="1" y="1" width="7" height="1" />
          <rect x="1" y="3" width="7" height="1" />
          <rect x="1" y="4" width="1" height="3" />
          <rect x="4" y="4" width="1" height="3" />
          <rect x="7" y="4" width="1" height="3" />
          <rect x="0" y="6" width="2" height="2" />
          <rect x="3" y="6" width="2" height="2" />
          <rect x="6" y="6" width="2" height="2" />
        </svg>
      );
    default:
      return null;
  }
};

// Classic Circular Rotary Knob (Unchanged, clean & boxless)
const Knob = ({ value, min = 0, max = 127, onChange, label, iconType, format = v => v, color = "text-cyan-400", hexColor = null, size = "md" }) => {
  const [isDragging, setIsDragging] = useState(false);
  const startY = useRef(0);
  const startVal = useRef(value);

  const percentage = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * 0.75;
  const strokeDashoffset = arcLength - (percentage * arcLength);

  const handlePointerDown = (e) => {
    e.target.setPointerCapture(e.pointerId);
    setIsDragging(true);
    startY.current = e.clientY;
    startVal.current = value;
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;
    const deltaY = startY.current - e.clientY;
    const range = max - min;
    const deltaVal = (deltaY / 140) * range;
    let newVal = startVal.current + deltaVal;
    newVal = Math.max(min, Math.min(max, newVal));
    onChange(Math.round(newVal));
  };

  const handlePointerUp = (e) => {
    e.target.releasePointerCapture(e.pointerId);
    setIsDragging(false);
  };

  const dimClass =
    size === "responsive"
      ? "w-7.5 h-7.5 sm:w-9 sm:h-9 md:w-10.5 md:h-10.5 xl:w-12 xl:h-12"
      : size === "sm"
        ? "w-9 h-9"
        : "w-12 h-12";

  return (
    <div className="flex flex-col items-center select-none group">
      <div
        className={`relative ${dimClass} flex items-center justify-center cursor-ns-resize touch-none`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <svg className="w-full h-full -rotate-[225deg]" viewBox="0 0 50 50" shapeRendering="geometricPrecision">
          <circle
            cx="25" cy="25" r={radius}
            fill="none"
            className="stroke-zinc-800"
            strokeWidth="3.5"
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeLinecap="round"
          />
          <circle
            cx="25" cy="25" r={radius}
            fill="none"
            style={hexColor ? { stroke: hexColor } : undefined}
            className={!hexColor ? `${color.replace('text-', 'stroke-')} transition-all duration-75` : 'transition-all duration-75'}
            strokeWidth="3.5"
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
          />
        </svg>

        <div
          style={hexColor ? { color: hexColor } : undefined}
          className={`absolute text-[8px] sm:text-[9px] md:text-[10px] font-bold tracking-tighter pointer-events-none ${!hexColor ? color : ''}`}
        >
          {format(value)}
        </div>
      </div>

      {iconType ? (
        <span
          title={label}
          style={hexColor ? { color: hexColor } : undefined}
          className={`mt-1 flex items-center justify-center ${!hexColor ? 'text-zinc-400' : ''}`}
        >
          <StepLockIcon type={iconType} />
        </span>
      ) : label ? (
        <span
          style={hexColor ? { color: hexColor } : undefined}
          className={`mt-1 text-[8px] sm:text-[9px] uppercase tracking-wider font-bold ${!hexColor ? 'text-zinc-500' : ''}`}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
};

const NumberDragger = ({ value, min = 0, max = 127, onChange, label, format = v => v, className = "", compact = false, micro = false, hexColor = null }) => {
  const [isDragging, setIsDragging] = useState(false);
  const startY = useRef(0);
  const startVal = useRef(value);

  const handlePointerDown = (e) => {
    e.target.setPointerCapture(e.pointerId);
    setIsDragging(true);
    startY.current = e.clientY;
    startVal.current = value;
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;
    const deltaY = startY.current - e.clientY;
    const deltaVal = (deltaY / 10);
    let newVal = startVal.current + deltaVal;
    newVal = Math.max(min, Math.min(max, Math.round(newVal)));
    if (newVal !== value) onChange(newVal);
  };

  const handlePointerUp = (e) => {
    e.target.releasePointerCapture(e.pointerId);
    setIsDragging(false);
  };

  const sizeClasses = micro
    ? 'text-[8px] leading-none px-1 py-0.5 w-9'
    : compact
      ? 'text-[9px] px-1.5 py-0.5 w-14'
      : 'text-[10px] px-2 py-1 w-16';

  return (
    <div className={`flex flex-col ${className}`}>
      {label && <span className="text-[8px] uppercase tracking-widest text-zinc-500 mb-1">{label}</span>}
      <div
        style={hexColor ? { color: hexColor } : undefined}
        className={`${sizeClasses} ${!hexColor ? 'text-zinc-200 hover:text-cyan-400' : ''} bg-transparent border-b-2 border-zinc-700 hover:border-zinc-400 rounded-none cursor-ns-resize text-center select-none font-bold`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {format(value)}
      </div>
    </div>
  );
};

// --- Main Application ---

export default function App() {
  const [tracks, setTracks] = useState(DEFAULT_TRACKS);
  const [selectedTrackId, setSelectedTrackId] = useState(0);
  const [selectedStepIndex, setSelectedStepIndex] = useState(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [followPlayhead, setFollowPlayhead] = useState(false);
  const [activeParamView, setActiveParamView] = useState(null);
  const [draggingPadStep, setDraggingPadStep] = useState(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isColorDropupOpen, setIsColorDropupOpen] = useState(false);
  const [customHexInput, setCustomHexInput] = useState(DEFAULT_TRACKS[0].color.hex);
  const [isMidiRoutingOpen, setIsMidiRoutingOpen] = useState(false);
  const [openCcMenuSlot, setOpenCcMenuSlot] = useState(null);

  // Uniform Proportional Viewport Scale (retains exact relative sizes & placements while filling screen)
  const workspaceRef = useRef(null);
  const [uiScale, setUiScale] = useState(1);

  // Pattern Bank State
  const [projectPatterns, setProjectPatterns] = useState(() => Array(8).fill(null));
  const [activeProjectPattern, setActiveProjectPattern] = useState(null);
  const [trackPatterns, setTrackPatterns] = useState(() =>
    Array.from({ length: NUM_TRACKS }, () => Array(8).fill(null))
  );
  const [activeTrackPatterns, setActiveTrackPatterns] = useState(() => Array(NUM_TRACKS).fill(null));
  const [patternMode, setPatternMode] = useState('load');

  // Global Randomization Density Settings (%)
  const [noteDensity, setNoteDensity] = useState(50);
  const [paraCcDensity, setParaCcDensity] = useState(75);
  const [continuousCCOutput, setContinuousCCOutput] = useState(true);

  // Audio & Transport State
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(120);

  // Sync Mode State ('internal' | 'link' | 'midi')
  const [syncMode, setSyncMode] = useState('internal');
  const linkEnabled = syncMode === 'link';
  const [linkRole, setLinkRole] = useState('host'); // 'host' | 'peer'
  const [linkPeers, setLinkPeers] = useState(0);
  const [linkPhase, setLinkPhase] = useState(0);
  const [linkStartStopSync, setLinkStartStopSync] = useState(true);

  // MIDI State
  const [midiInputs, setMidiInputs] = useState([]);
  const [selectedMidiInputId, setSelectedMidiInputId] = useState("");
  const [midiOutputs, setMidiOutputs] = useState([]);
  const [selectedMidiOutputId, setSelectedMidiOutputId] = useState("");
  const [sendMidiClockOut, setSendMidiClockOut] = useState(false);
  const [midiError, setMidiError] = useState(null);

  // Runtime Scheduling State
  const audioCtxRef = useRef(null);
  const timerIdRef = useRef(null);
  const midiClockTimerRef = useRef(null);
  const tracksRef = useRef(tracks);
  const bpmRef = useRef(bpm);
  const isPlayingRef = useRef(isPlaying);
  const continuousCCOutputRef = useRef(continuousCCOutput);
  const midiOutputRef = useRef(null);
  const syncModeRef = useRef(syncMode);
  const linkEnabledRef = useRef(linkEnabled);
  const linkRoleRef = useRef(linkRole);
  const selectedMidiInputIdRef = useRef(selectedMidiInputId);
  const linkStartStopSyncRef = useRef(linkStartStopSync);
  const linkChannelRef = useRef(null);
  const linkPeerIdRef = useRef(`opal-link-${Math.random().toString(36).slice(2, 9)}`);
  const linkPeersMapRef = useRef(new Map());
  const linkOriginTimeRef = useRef(performance.now());
  const linkBeatOriginRef = useRef(0);
  const lastMidiClockTickRef = useRef(0);

  // Track scheduler memory
  const schedulerState = useRef(
    Array.from({ length: NUM_TRACKS }, () => ({
      currentStep: 0,
      nextNoteTime: 0.0
    }))
  );

  // Visual State
  const [playingSteps, setPlayingSteps] = useState({});

  // Compute uniform scale so the entire sequencer fills the viewport while keeping exact relative proportions
  useEffect(() => {
    const BASE_WIDTH = 840;
    const BASE_HEIGHT = 430;
    const updateScale = () => {
      const container = workspaceRef.current;
      const availW = container ? container.clientWidth : window.innerWidth;
      const availH = container ? container.clientHeight : window.innerHeight;
      if (availW <= 0 || availH <= 0) return;
      const nextScale = Math.min(availW / BASE_WIDTH, availH / BASE_HEIGHT);
      setUiScale(Math.max(0.35, nextScale));
    };

    updateScale();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateScale) : null;
    if (ro && workspaceRef.current) {
      ro.observe(workspaceRef.current);
    }
    window.addEventListener('resize', updateScale);
    window.addEventListener('orientationchange', updateScale);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', updateScale);
      window.removeEventListener('orientationchange', updateScale);
    };
  }, []);

  // Lock orientation to landscape whenever supported (Web / Android WebView / Capacitor)
  useEffect(() => {
    const lockLandscape = async () => {
      try {
        if (window.Capacitor?.Plugins?.ScreenOrientation?.lock) {
          await window.Capacitor.Plugins.ScreenOrientation.lock({ orientation: 'landscape' });
        }
        if (window.screen?.orientation?.lock) {
          await window.screen.orientation.lock('landscape');
        }
      } catch {
        // Ignored when browser requires user gesture or AndroidManifest handles orientation
      }
    };
    lockLandscape();
  }, []);

  // Load crisp pixel font dynamically so standalone & preview look identical
  useEffect(() => {
    if (!document.getElementById('opal-pixel-font')) {
      const link = document.createElement('link');
      link.id = 'opal-pixel-font';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&display=swap';
      document.head.appendChild(link);
    }
  }, []);

  // Sync refs for scheduler loop
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { continuousCCOutputRef.current = continuousCCOutput; }, [continuousCCOutput]);
  useEffect(() => { syncModeRef.current = syncMode; linkEnabledRef.current = syncMode === 'link'; }, [syncMode]);
  useEffect(() => { linkRoleRef.current = linkRole; }, [linkRole]);
  useEffect(() => { selectedMidiInputIdRef.current = selectedMidiInputId; }, [selectedMidiInputId]);
  useEffect(() => { linkStartStopSyncRef.current = linkStartStopSync; }, [linkStartStopSync]);
  useEffect(() => {
    const out = midiOutputs.find(o => o.id === selectedMidiOutputId);
    midiOutputRef.current = out || null;
  }, [selectedMidiOutputId, midiOutputs]);

  // --- Ableton Link Host & Peer Engine ---
  const getCurrentLinkBeat = useCallback(() => {
    const elapsedSec = (performance.now() - linkOriginTimeRef.current) / 1000;
    return linkBeatOriginRef.current + elapsedSec * (bpmRef.current / 60);
  }, []);

  const broadcastLinkState = useCallback((type, extra = {}) => {
    if (!linkChannelRef.current || !linkEnabledRef.current) return;
    linkChannelRef.current.postMessage({
      type,
      peerId: linkPeerIdRef.current,
      bpm: bpmRef.current,
      beat: getCurrentLinkBeat(),
      isPlaying: isPlayingRef.current,
      timestamp: performance.now(),
      ...extra
    });
  }, [getCurrentLinkBeat]);

  const handleTempoChange = useCallback((newBpm, fromRemote = false) => {
    const clampedBpm = Math.max(30, Math.min(300, newBpm));
    linkBeatOriginRef.current = getCurrentLinkBeat();
    linkOriginTimeRef.current = performance.now();
    bpmRef.current = clampedBpm;
    setBpm(clampedBpm);

    if (!fromRemote && linkEnabledRef.current) {
      broadcastLinkState('LINK_TEMPO', { bpm: clampedBpm, isHost: linkRoleRef.current === 'host' });
      if (window.Capacitor?.Plugins?.AbletonLink?.setTempo) {
        window.Capacitor.Plugins.AbletonLink.setTempo({ bpm: clampedBpm, isHost: linkRoleRef.current === 'host' }).catch(() => {});
      }
    }
  }, [getCurrentLinkBeat, broadcastLinkState]);

  useEffect(() => {
    if (!linkEnabled) {
      setLinkPeers(0);
      setLinkPhase(0);
      linkPeersMapRef.current.clear();
      if (linkChannelRef.current) {
        linkChannelRef.current.postMessage({ type: 'LINK_BYE', peerId: linkPeerIdRef.current });
        linkChannelRef.current.close();
        linkChannelRef.current = null;
      }
      if (window.Capacitor?.Plugins?.AbletonLink?.disable) {
        window.Capacitor.Plugins.AbletonLink.disable().catch(() => {});
      }
      return;
    }

    if (window.Capacitor?.Plugins?.AbletonLink?.enable) {
      window.Capacitor.Plugins.AbletonLink.enable({
        bpm: bpmRef.current,
        isHost: linkRoleRef.current === 'host',
        quantum: LINK_QUANTUM
      }).catch(() => {});
    }

    const channel = new BroadcastChannel('ableton-link-session-v1');
    linkChannelRef.current = channel;
    linkBeatOriginRef.current = 0;
    linkOriginTimeRef.current = performance.now();

    channel.onmessage = (event) => {
      const msg = event.data;
      if (!msg || msg.peerId === linkPeerIdRef.current) return;

      if (msg.type === 'LINK_BYE') {
        linkPeersMapRef.current.delete(msg.peerId);
        setLinkPeers(linkPeersMapRef.current.size);
        return;
      }

      linkPeersMapRef.current.set(msg.peerId, performance.now());
      setLinkPeers(linkPeersMapRef.current.size);

      const localIsHost = linkRoleRef.current === 'host';

      if (msg.type === 'LINK_JOIN' && localIsHost) {
        channel.postMessage({
          type: 'LINK_HOST_SYNC',
          peerId: linkPeerIdRef.current,
          isHost: true,
          bpm: bpmRef.current,
          beat: getCurrentLinkBeat(),
          isPlaying: isPlayingRef.current,
          timestamp: performance.now()
        });
        return;
      }

      if (
        msg.type === 'LINK_HEARTBEAT' ||
        msg.type === 'LINK_TEMPO' ||
        msg.type === 'LINK_JOIN' ||
        msg.type === 'LINK_HOST_SYNC'
      ) {
        const shouldAdoptTempo =
          msg.type === 'LINK_TEMPO' ||
          (!localIsHost && (msg.isHost || msg.type === 'LINK_HEARTBEAT' || msg.type === 'LINK_HOST_SYNC'));

        if (shouldAdoptTempo && msg.bpm && Math.abs(msg.bpm - bpmRef.current) > 0.01) {
          handleTempoChange(msg.bpm, true);
        }

        if (!localIsHost && typeof msg.beat === 'number') {
          const latencySec = Math.max(0, (performance.now() - msg.timestamp) / 1000);
          const remoteBeatNow = msg.beat + latencySec * ((msg.bpm || bpmRef.current) / 60);
          linkBeatOriginRef.current = remoteBeatNow;
          linkOriginTimeRef.current = performance.now();
        }
      }

      if (msg.type === 'LINK_TRANSPORT' && linkStartStopSync) {
        window.dispatchEvent(new CustomEvent('opal-link-transport', { detail: { isPlaying: msg.isPlaying } }));
      }
    };

    channel.postMessage({
      type: linkRoleRef.current === 'host' ? 'LINK_HOST_SYNC' : 'LINK_JOIN',
      peerId: linkPeerIdRef.current,
      isHost: linkRoleRef.current === 'host',
      bpm: bpmRef.current,
      beat: getCurrentLinkBeat(),
      isPlaying: isPlayingRef.current,
      timestamp: performance.now()
    });

    const heartbeatInterval = setInterval(() => {
      const now = performance.now();
      for (const [id, lastSeen] of linkPeersMapRef.current.entries()) {
        if (now - lastSeen > 3000) linkPeersMapRef.current.delete(id);
      }
      setLinkPeers(linkPeersMapRef.current.size);

      const currentBeat = getCurrentLinkBeat();
      setLinkPhase(((currentBeat % LINK_QUANTUM) + LINK_QUANTUM) % LINK_QUANTUM);

      channel.postMessage({
        type: 'LINK_HEARTBEAT',
        peerId: linkPeerIdRef.current,
        isHost: linkRoleRef.current === 'host',
        bpm: bpmRef.current,
        beat: currentBeat,
        isPlaying: isPlayingRef.current,
        timestamp: now
      });
    }, linkRole === 'host' ? 30 : 60);

    return () => {
      clearInterval(heartbeatInterval);
      if (linkChannelRef.current) {
        linkChannelRef.current.postMessage({ type: 'LINK_BYE', peerId: linkPeerIdRef.current });
        linkChannelRef.current.close();
        linkChannelRef.current = null;
      }
    };
  }, [linkEnabled, linkRole, linkStartStopSync, getCurrentLinkBeat, handleTempoChange]);

  // --- Web MIDI Initialization & External MIDI Clock Input Sync ---
  useEffect(() => {
    if (!navigator.requestMIDIAccess) {
      setMidiError("Web MIDI API not supported in this browser");
      return;
    }

    try {
      navigator.requestMIDIAccess({ sysex: false })
        .then(midiAccess => {
          const inputs = Array.from(midiAccess.inputs.values());
          const outputs = Array.from(midiAccess.outputs.values());
          setMidiInputs(inputs);
          setMidiOutputs(outputs);
          if (outputs.length > 0) setSelectedMidiOutputId(outputs[0].id);

          const bindInputs = () => {
            midiAccess.inputs.forEach((input) => {
              input.onmidimessage = (msg) => {
                if (syncModeRef.current !== 'midi') return;
                if (selectedMidiInputIdRef.current && input.id !== selectedMidiInputIdRef.current) return;

                const status = msg.data[0];
                if (status === 0xF8) {
                  const now = performance.now();
                  if (lastMidiClockTickRef.current > 0) {
                    const dtMs = now - lastMidiClockTickRef.current;
                    if (dtMs > 2 && dtMs < 200) {
                      const instantBpm = 60000 / (dtMs * 24);
                      if (instantBpm >= 30 && instantBpm <= 300) {
                        const smoothedBpm = bpmRef.current * 0.8 + instantBpm * 0.2;
                        handleTempoChange(smoothedBpm, true);
                      }
                    }
                  }
                  lastMidiClockTickRef.current = now;
                } else if (status === 0xFA && linkStartStopSyncRef.current) {
                  window.dispatchEvent(new CustomEvent('opal-link-transport', { detail: { isPlaying: true } }));
                } else if (status === 0xFC && linkStartStopSyncRef.current) {
                  window.dispatchEvent(new CustomEvent('opal-link-transport', { detail: { isPlaying: false } }));
                }
              };
            });
          };

          bindInputs();
          midiAccess.onstatechange = () => {
            setMidiInputs(Array.from(midiAccess.inputs.values()));
            setMidiOutputs(Array.from(midiAccess.outputs.values()));
            bindInputs();
          };
        })
        .catch(err => {
          setMidiError(
            err.name === "SecurityError"
              ? "MIDI blocked by preview sandbox (works in standalone/APK)"
              : "MIDI unavailable"
          );
        });
    } catch (err) {
      setMidiError("MIDI blocked by permissions policy");
    }
  }, [handleTempoChange, linkStartStopSync]);

  // --- Silent High-Precision Clock & MIDI Output ---
  const sendMidiCC = useCallback((channel, cc, value, time) => {
    const output = midiOutputRef.current;
    if (!output || !audioCtxRef.current) return;

    const audioCtxTime = audioCtxRef.current.currentTime;
    const perfNow = performance.now();
    const timeDeltaMs = Math.max(0, (time - audioCtxTime) * 1000);
    const scheduleTimeMs = perfNow + timeDeltaMs;

    output.send([0xB0 + channel, cc & 0x7F, value & 0x7F], scheduleTimeMs);
  }, []);

  const sendMidiNote = useCallback((channel, note, velocity, time, duration = 0.1) => {
    const output = midiOutputRef.current;
    if (!output || !audioCtxRef.current) return;

    const audioCtxTime = audioCtxRef.current.currentTime;
    const perfNow = performance.now();
    const timeDeltaMs = Math.max(0, (time - audioCtxTime) * 1000);
    const scheduleTimeMs = perfNow + timeDeltaMs;

    output.send([0x90 + channel, note, velocity], scheduleTimeMs);
    output.send([0x80 + channel, note, 0], scheduleTimeMs + (duration * 1000));
  }, []);

  const scheduleStep = useCallback((track, stepIndex, time) => {
    const step = track.steps[stepIndex];

    if (continuousCCOutputRef.current || step.active) {
      track.ccConfigs.forEach((cfg, idx) => {
        const lockedVal = step.ccLocks ? step.ccLocks[idx] : null;
        const valToSend = lockedVal !== null && lockedVal !== undefined ? lockedVal : cfg.defaultValue;
        sendMidiCC(track.channel, cfg.cc, valToSend, time);
      });
    }

    if (!step.active) return;

    if (step.probability < 100) {
      if (Math.random() * 100 > step.probability) return;
    }

    const secondsPerBeat = 60.0 / bpmRef.current;
    const stepDurationSeconds = secondsPerBeat * track.division;
    const effectiveNote = Math.max(0, Math.min(127, track.note + (step.pitch || 0)));

    if (step.ratchet > 1) {
      const ratchetDuration = stepDurationSeconds / step.ratchet;
      for (let r = 0; r < step.ratchet; r++) {
        sendMidiNote(track.channel, effectiveNote, step.velocity, time + (r * ratchetDuration), ratchetDuration * 0.8);
      }
    } else {
      sendMidiNote(track.channel, effectiveNote, step.velocity, time, stepDurationSeconds * 0.8);
    }
  }, [sendMidiNote, sendMidiCC]);

  const schedulerLoop = useCallback(() => {
    if (!isPlayingRef.current) return;

    const ctx = audioCtxRef.current;
    const currentAudioTime = ctx.currentTime;
    let nextPlayingSteps = {};
    let stepsChanged = false;

    tracksRef.current.forEach((track, i) => {
      let state = schedulerState.current[i];

      while (state.nextNoteTime < currentAudioTime + SCHEDULE_AHEAD_TIME) {
        if (state.currentStep < track.length) {
          scheduleStep(track, state.currentStep, state.nextNoteTime);
          nextPlayingSteps[i] = state.currentStep;
          stepsChanged = true;
        }

        const secondsPerBeat = 60.0 / bpmRef.current;
        state.nextNoteTime += secondsPerBeat * track.division;
        state.currentStep = (state.currentStep + 1) % track.length;
      }
    });

    if (stepsChanged) {
      setPlayingSteps(prev => ({ ...prev, ...nextPlayingSteps }));
    }

    timerIdRef.current = setTimeout(schedulerLoop, LOOKAHEAD);
  }, [scheduleStep]);

  useEffect(() => {
    if (!followPlayhead || !isPlaying) return;
    const playingStep = playingSteps[selectedTrackId];
    if (playingStep !== undefined) {
      const targetPage = Math.floor(playingStep / STEPS_PER_PAGE);
      if (targetPage !== currentPage) {
        setCurrentPage(targetPage);
      }
    }
  }, [playingSteps, selectedTrackId, followPlayhead, isPlaying, currentPage]);

  // --- Transport Controls ---
  const startPlayback = useCallback((fromRemoteLink = false) => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }

    let startBuffer = 0.05;
    if (linkEnabledRef.current) {
      const currentBeat = getCurrentLinkBeat();
      const fracBeat = currentBeat - Math.floor(currentBeat);
      const beatsUntilNextBeat = fracBeat > 0.05 ? (1 - fracBeat) : 0;
      startBuffer = Math.max(0.03, beatsUntilNextBeat * (60.0 / bpmRef.current));
    }

    const startTime = audioCtxRef.current.currentTime + startBuffer;
    schedulerState.current = Array.from({ length: NUM_TRACKS }, () => ({
      currentStep: 0,
      nextNoteTime: startTime
    }));
    setIsPlaying(true);

    if (!fromRemoteLink && linkEnabledRef.current && linkStartStopSync) {
      broadcastLinkState('LINK_TRANSPORT', { isPlaying: true });
      if (window.Capacitor?.Plugins?.AbletonLink?.setIsPlaying) {
        window.Capacitor.Plugins.AbletonLink.setIsPlaying({ isPlaying: true }).catch(() => {});
      }
    }
  }, [getCurrentLinkBeat, broadcastLinkState, linkStartStopSync]);

  const stopPlayback = useCallback((fromRemoteLink = false) => {
    setIsPlaying(false);
    clearTimeout(timerIdRef.current);
    setPlayingSteps({});
    if (midiOutputRef.current) {
      if (sendMidiClockOut) {
        midiOutputRef.current.send([0xFC]);
      }
      for (let i = 0; i < 16; i++) {
        midiOutputRef.current.send([0xB0 + i, 123, 0]);
      }
    }

    if (!fromRemoteLink && linkEnabledRef.current && linkStartStopSync) {
      broadcastLinkState('LINK_TRANSPORT', { isPlaying: false });
      if (window.Capacitor?.Plugins?.AbletonLink?.setIsPlaying) {
        window.Capacitor.Plugins.AbletonLink.setIsPlaying({ isPlaying: false }).catch(() => {});
      }
    }
  }, [broadcastLinkState, linkStartStopSync, sendMidiClockOut]);

  useEffect(() => {
    if (!isPlaying || !sendMidiClockOut || !midiOutputRef.current) {
      clearInterval(midiClockTimerRef.current);
      return;
    }
    midiOutputRef.current.send([0xFA]);
    const tickMs = (60 / bpm) / 24 * 1000;
    midiClockTimerRef.current = setInterval(() => {
      if (midiOutputRef.current && isPlayingRef.current) {
        midiOutputRef.current.send([0xF8]);
      }
    }, Math.max(2, tickMs));
    return () => clearInterval(midiClockTimerRef.current);
  }, [isPlaying, sendMidiClockOut, bpm]);

  useEffect(() => {
    const onLinkTransport = (e) => {
      if (e.detail?.isPlaying && !isPlayingRef.current) {
        startPlayback(true);
      } else if (!e.detail?.isPlaying && isPlayingRef.current) {
        stopPlayback(true);
      }
    };
    window.addEventListener('opal-link-transport', onLinkTransport);
    return () => window.removeEventListener('opal-link-transport', onLinkTransport);
  }, [startPlayback, stopPlayback]);

  useEffect(() => {
    if (isPlaying) {
      schedulerLoop();
    }
    return () => clearTimeout(timerIdRef.current);
  }, [isPlaying, schedulerLoop]);

  // --- Track Manipulation ---
  const updateTrack = (trackId, key, value) => {
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, [key]: value } : t));
    if (key === 'length' && value > 0) {
      const maxPageForLength = Math.floor((value - 1) / STEPS_PER_PAGE);
      if (currentPage > maxPageForLength) {
        setCurrentPage(maxPageForLength);
      }
    }
  };

  const applyCustomTrackHex = (trackId, rawHex) => {
    const normalized = rawHex.startsWith('#') ? rawHex : `#${rawHex}`;
    if (!/^#[0-9A-Fa-f]{6}$/.test(normalized)) return;
    const upperHex = normalized.toUpperCase();
    const matchedPreset = TRACK_COLORS.find(c => c.hex.toUpperCase() === upperHex);
    const nextColor = matchedPreset || {
      name: upperHex,
      hex: upperHex,
      rgb: hexToRgbString(upperHex)
    };
    updateTrack(trackId, 'color', nextColor);
  };

  const toggleStep = (trackId, stepIndex) => {
    setTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      const newSteps = [...t.steps];
      newSteps[stepIndex] = { ...newSteps[stepIndex], active: !newSteps[stepIndex].active };
      return { ...t, steps: newSteps };
    }));
    setSelectedStepIndex(stepIndex);
  };

  const updateStepParam = (param, value) => {
    if (selectedStepIndex === null) return;
    setTracks(prev => prev.map(t => {
      if (t.id !== selectedTrackId) return t;
      const newSteps = [...t.steps];
      newSteps[selectedStepIndex] = { ...newSteps[selectedStepIndex], [param]: value };
      return { ...t, steps: newSteps };
    }));
  };

  const updateTrackCCNumber = (ccSlotIndex, ccNum) => {
    setTracks(prev => prev.map(t => {
      if (t.id !== selectedTrackId) return t;
      const newConfigs = t.ccConfigs.map((cfg, idx) =>
        idx === ccSlotIndex ? { ...cfg, cc: ccNum } : cfg
      );
      return { ...t, ccConfigs: newConfigs };
    }));
  };

  const handleCCKnobChange = (ccSlotIndex, newVal) => {
    const track = tracks.find(t => t.id === selectedTrackId);
    if (!track) return;

    if (midiOutputRef.current) {
      const ccNum = track.ccConfigs[ccSlotIndex].cc;
      midiOutputRef.current.send([0xB0 + track.channel, ccNum & 0x7F, newVal & 0x7F]);
    }

    if (selectedStepIndex !== null) {
      setTracks(prev => prev.map(t => {
        if (t.id !== selectedTrackId) return t;
        const newSteps = [...t.steps];
        const currentLocks = [...(newSteps[selectedStepIndex].ccLocks || [null, null, null, null])];
        currentLocks[ccSlotIndex] = newVal;
        newSteps[selectedStepIndex] = { ...newSteps[selectedStepIndex], ccLocks: currentLocks };
        return { ...t, steps: newSteps };
      }));
    } else {
      setTracks(prev => prev.map(t => {
        if (t.id !== selectedTrackId) return t;
        const newConfigs = t.ccConfigs.map((cfg, idx) =>
          idx === ccSlotIndex ? { ...cfg, defaultValue: newVal } : cfg
        );
        return { ...t, ccConfigs: newConfigs };
      }));
    }
  };

  const clearStepCCLock = (ccSlotIndex) => {
    if (selectedStepIndex === null) return;
    setTracks(prev => prev.map(t => {
      if (t.id !== selectedTrackId) return t;
      const newSteps = [...t.steps];
      const currentLocks = [...(newSteps[selectedStepIndex].ccLocks || [null, null, null, null])];
      currentLocks[ccSlotIndex] = null;
      newSteps[selectedStepIndex] = { ...newSteps[selectedStepIndex], ccLocks: currentLocks };
      return { ...t, steps: newSteps };
    }));
  };

  // --- Dice Randomization Per Knob Column Across Track Steps ---
  const randomizeKnobAcrossTrack = (paramKey, ccSlotIndex = null) => {
    const densityProb = paraCcDensity / 100;
    setTracks(prev => prev.map(t => {
      if (t.id !== selectedTrackId) return t;
      const newSteps = t.steps.map(step => {
        const updatedStep = {
          ...step,
          ccLocks: step.ccLocks ? [...step.ccLocks] : [null, null, null, null]
        };
        const shouldRandomize = Math.random() < densityProb;
        if (paramKey === 'pitch') {
          updatedStep.pitch = shouldRandomize ? Math.floor(Math.random() * 49) - 24 : 0;
        } else if (paramKey === 'velocity') {
          updatedStep.velocity = shouldRandomize ? Math.floor(Math.random() * 118) + 10 : 100;
        } else if (paramKey === 'probability') {
          updatedStep.probability = shouldRandomize ? Math.floor(Math.random() * 101) : 100;
        } else if (paramKey === 'ratchet') {
          updatedStep.ratchet = shouldRandomize ? Math.floor(Math.random() * 8) + 1 : 1;
        } else if (paramKey === 'cc' && ccSlotIndex !== null) {
          updatedStep.ccLocks[ccSlotIndex] = shouldRandomize ? Math.floor(Math.random() * 128) : null;
        }
        return updatedStep;
      });
      return { ...t, steps: newSteps };
    }));

    if (paramKey === 'cc' && ccSlotIndex !== null) {
      setActiveParamView(`cc${ccSlotIndex}`);
    } else {
      setActiveParamView(paramKey);
    }
  };

  const randomizeNotesAcrossTrack = () => {
    const noteProb = noteDensity / 100;
    setTracks(prev => prev.map(t => {
      if (t.id !== selectedTrackId) return t;
      const newSteps = t.steps.map(step => ({
        ...step,
        active: Math.random() < noteProb
      }));
      return { ...t, steps: newSteps };
    }));
  };

  const randomizeAllEightKnobsAcrossTrack = () => {
    const densityProb = paraCcDensity / 100;
    setTracks(prev => prev.map(t => {
      if (t.id !== selectedTrackId) return t;
      const newSteps = t.steps.map(step => ({
        ...step,
        pitch: Math.random() < densityProb ? Math.floor(Math.random() * 49) - 24 : 0,
        velocity: Math.random() < densityProb ? Math.floor(Math.random() * 118) + 10 : 100,
        probability: Math.random() < densityProb ? Math.floor(Math.random() * 101) : 100,
        ratchet: Math.random() < densityProb ? Math.floor(Math.random() * 8) + 1 : 1,
        ccLocks: [0, 1, 2, 3].map(() => (Math.random() < densityProb ? Math.floor(Math.random() * 128) : null))
      }));
      return { ...t, steps: newSteps };
    }));
    if (!activeParamView) {
      setActiveParamView('pitch');
    }
  };

  // --- Project & Per-Track Pattern Save / Load / Clear ---
  const handleProjectPatternSlot = (slotIdx) => {
    if (patternMode === 'save') {
      const snapshot = {
        bpm,
        tracks: tracks.map(cloneTrack)
      };
      setProjectPatterns(prev => {
        const next = [...prev];
        next[slotIdx] = snapshot;
        return next;
      });
      setActiveProjectPattern(slotIdx);
      setPatternMode('load');
    } else if (patternMode === 'clear') {
      setProjectPatterns(prev => {
        const next = [...prev];
        next[slotIdx] = null;
        return next;
      });
      if (activeProjectPattern === slotIdx) setActiveProjectPattern(null);
      setPatternMode('load');
    } else {
      const saved = projectPatterns[slotIdx];
      if (!saved) {
        const snapshot = {
          bpm,
          tracks: tracks.map(cloneTrack)
        };
        setProjectPatterns(prev => {
          const next = [...prev];
          next[slotIdx] = snapshot;
          return next;
        });
        setActiveProjectPattern(slotIdx);
        return;
      }
      setTracks(saved.tracks.map(cloneTrack));
      if (typeof saved.bpm === 'number') {
        handleTempoChange(saved.bpm, false);
      }
      setActiveProjectPattern(slotIdx);
      setSelectedStepIndex(null);
    }
  };

  const handleTrackPatternSlot = (slotIdx) => {
    if (patternMode === 'save') {
      const snapshot = cloneTrack(tracks[selectedTrackId]);
      setTrackPatterns(prev => {
        const next = prev.map(arr => [...arr]);
        next[selectedTrackId][slotIdx] = snapshot;
        return next;
      });
      setActiveTrackPatterns(prev => {
        const next = [...prev];
        next[selectedTrackId] = slotIdx;
        return next;
      });
      setPatternMode('load');
    } else if (patternMode === 'clear') {
      setTrackPatterns(prev => {
        const next = prev.map(arr => [...arr]);
        next[selectedTrackId][slotIdx] = null;
        return next;
      });
      setActiveTrackPatterns(prev => {
        const next = [...prev];
        if (next[selectedTrackId] === slotIdx) next[selectedTrackId] = null;
        return next;
      });
      setPatternMode('load');
    } else {
      const saved = trackPatterns[selectedTrackId]?.[slotIdx];
      if (!saved) {
        const snapshot = cloneTrack(tracks[selectedTrackId]);
        setTrackPatterns(prev => {
          const next = prev.map(arr => [...arr]);
          next[selectedTrackId][slotIdx] = snapshot;
          return next;
        });
        setActiveTrackPatterns(prev => {
          const next = [...prev];
          next[selectedTrackId] = slotIdx;
          return next;
        });
        return;
      }
      setTracks(prev =>
        prev.map(t => (t.id === selectedTrackId ? { ...cloneTrack(saved), id: selectedTrackId } : t))
      );
      setActiveTrackPatterns(prev => {
        const next = [...prev];
        next[selectedTrackId] = slotIdx;
        return next;
      });
      setSelectedStepIndex(null);
    }
  };

  const currentTrack = tracks.find(t => t.id === selectedTrackId);

  // --- Parameter View Helpers ---
  const paramViews = [
    { id: 'pitch', label: 'Pitch', iconType: 'pitch', min: -24, max: 24 },
    { id: 'velocity', label: 'Vel', iconType: 'velocity', min: 0, max: 127 },
    { id: 'probability', label: 'Prob', iconType: 'probability', min: 0, max: 100 },
    { id: 'ratchet', label: 'Ratch', iconType: 'ratchet', min: 1, max: 8 },
    { id: 'cc0', label: `CC${currentTrack.ccConfigs[0].cc}`, min: 0, max: 127, ccIdx: 0 },
    { id: 'cc1', label: `CC${currentTrack.ccConfigs[1].cc}`, min: 0, max: 127, ccIdx: 1 },
    { id: 'cc2', label: `CC${currentTrack.ccConfigs[2].cc}`, min: 0, max: 127, ccIdx: 2 },
    { id: 'cc3', label: `CC${currentTrack.ccConfigs[3].cc}`, min: 0, max: 127, ccIdx: 3 },
  ];

  const getStepViewValueAndRatio = (track, step, viewId) => {
    if (!viewId) return { value: 0, ratio: 0, formatted: '' };
    if (viewId === 'pitch') {
      const p = step.pitch || 0;
      return { value: p, ratio: (p + 24) / 48, formatted: `${p > 0 ? '+' : ''}${p}` };
    }
    if (viewId === 'velocity') {
      return { value: step.velocity, ratio: step.velocity / 127, formatted: `${step.velocity}` };
    }
    if (viewId === 'probability') {
      return { value: step.probability, ratio: step.probability / 100, formatted: `${step.probability}%` };
    }
    if (viewId === 'ratchet') {
      return { value: step.ratchet, ratio: (step.ratchet - 1) / 7, formatted: `x${step.ratchet}` };
    }
    if (viewId.startsWith('cc')) {
      const ccIdx = parseInt(viewId.replace('cc', ''), 10);
      const lockedVal = step.ccLocks?.[ccIdx];
      const val = lockedVal !== null && lockedVal !== undefined ? lockedVal : track.ccConfigs[ccIdx].defaultValue;
      return { value: val, ratio: val / 127, formatted: `${val}` };
    }
    return { value: 0, ratio: 0, formatted: '' };
  };

  const setStepValueFromRatio = (trackId, stepIndex, viewId, ratio) => {
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    setTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      const newSteps = [...t.steps];
      const targetStep = { ...newSteps[stepIndex] };

      if (viewId === 'pitch') {
        targetStep.pitch = Math.round(-24 + clampedRatio * 48);
      } else if (viewId === 'velocity') {
        targetStep.velocity = Math.round(clampedRatio * 127);
      } else if (viewId === 'probability') {
        targetStep.probability = Math.round(clampedRatio * 100);
      } else if (viewId === 'ratchet') {
        targetStep.ratchet = Math.round(1 + clampedRatio * 7);
      } else if (viewId.startsWith('cc')) {
        const ccIdx = parseInt(viewId.replace('cc', ''), 10);
        const newVal = Math.round(clampedRatio * 127);
        const currentLocks = [...(targetStep.ccLocks || [null, null, null, null])];
        currentLocks[ccIdx] = newVal;
        targetStep.ccLocks = currentLocks;
      }

      newSteps[stepIndex] = targetStep;
      return { ...t, steps: newSteps };
    }));
  };

  const handlePadPointerInteraction = (e, trackId, stepIndex) => {
    if (!activeParamView) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const ratio = 1 - (relY / rect.height);
    setStepValueFromRatio(trackId, stepIndex, activeParamView, ratio);
    setSelectedStepIndex(stepIndex);
  };

  const currentStepData = selectedStepIndex !== null ? currentTrack.steps[selectedStepIndex] : null;
  const pageStartIndex = currentPage * STEPS_PER_PAGE;
  const visibleSteps = currentTrack.steps.slice(pageStartIndex, pageStartIndex + STEPS_PER_PAGE);
  const invertedTrackHex = getInvertedHex(currentTrack.color.hex);

  // --- Rendering ---
  return (
    <div
      style={{ fontFamily: "'Silkscreen', 'Courier New', monospace" }}
      className="flex flex-col h-[100dvh] w-full bg-[#09090b] text-zinc-300 text-[10px] overflow-hidden select-none antialiased"
    >
      {/* PORTRAIT OVERLAY GUARD (Prompts rotation if WebView/browser hasn't locked yet) */}
      <div className="portrait:flex landscape:hidden fixed inset-0 z-50 bg-[#09090b] flex-col items-center justify-center p-6 text-center gap-3">
        <div className="w-14 h-9 rounded-lg border-4 border-cyan-400 flex items-center justify-center">
          <span className="w-2 h-2 rounded-sm bg-cyan-400 animate-pulse" />
        </div>
        <div className="text-zinc-100 font-bold text-xs tracking-widest uppercase">
          OPAL-CTL // LANDSCAPE ONLY
        </div>
        <p className="text-zinc-400 text-[9px] max-w-xs leading-relaxed uppercase">
          ROTATE DEVICE TO LANDSCAPE MODE TO USE THE 8-TRACK SEQUENCER
        </p>
      </div>

      {/* MAIN FULL-SCREEN MINIMAL INTERFACE (NO BOXY WRAPPERS) */}
      <div className="flex flex-col flex-1 min-h-0 w-full h-full overflow-hidden relative">

        {/* MINIMAL HEADER STRIP */}
        <div className="h-7 border-b-[3px] border-zinc-800 flex items-center justify-between px-4 shrink-0 relative gap-2">
          <div className="flex items-center gap-2 shrink-0">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-cyan-400" />
            <span className="text-zinc-100 font-bold text-xs tracking-widest uppercase">
              OPAL-CTL
            </span>
            <span className="text-[8px] text-cyan-400/80 uppercase tracking-widest hidden sm:inline">
              // MIDI ONLY
            </span>
          </div>

          <div className="text-zinc-500 text-[9px] tracking-wider uppercase flex items-center gap-1.5 truncate">
            {patternMode === 'save' ? (
              <span className="text-amber-400 font-bold">[SELECT SLOT TO SAVE]</span>
            ) : patternMode === 'clear' ? (
              <span className="text-rose-400 font-bold">[SELECT SLOT TO CLEAR]</span>
            ) : activeParamView ? (
              <span>DRAG PADS: {paramViews.find(v => v.id === activeParamView)?.label}</span>
            ) : (
              <span>TAP:STEP • R-CLICK:LOCK</span>
            )}
          </div>
        </div>

        {/* FULL-SCREEN ADAPTIVE WORKSPACE (UNIFORMLY SCALED TO FILL VIEWPORT) */}
        <div
          ref={workspaceRef}
          className="flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden relative"
        >
          <div
            style={{
              width: '820px',
              transform: `scale(${uiScale})`,
              transformOrigin: 'center center'
            }}
            className="shrink-0 flex flex-col justify-center gap-2.5 px-2 py-1"
          >

            {/* BOXLESS TRANSPORT, SYNC, MIDI & PROJECT PATTERN ROW */}
            <div className="w-full flex flex-nowrap items-center justify-between gap-2.5 py-1 border-b-[3px] border-zinc-800 relative shrink-0">
              {/* Play & Stop + BPM */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => { if (!isPlaying) startPlayback(false); }}
                  title="Play"
                  className={`px-2.5 py-1 rounded-md border-[3px] text-[9px] font-bold flex items-center justify-center transition-none ${
                    isPlaying
                      ? 'bg-cyan-400 text-zinc-950 border-cyan-300'
                      : 'border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:border-zinc-500'
                  }`}
                >
                  <PixelPlayIcon className="w-2.5 h-2.5" />
                </button>
                <button
                  onClick={() => stopPlayback(false)}
                  title="Stop"
                  className="px-2.5 py-1 rounded-md border-[3px] border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:border-zinc-500 text-[9px] font-bold flex items-center justify-center transition-none"
                >
                  <PixelStopIcon className="w-2.5 h-2.5" />
                </button>
                <span className="text-[8px] uppercase tracking-widest text-zinc-500 ml-1">BPM</span>
                <NumberDragger
                  compact
                  value={Math.round(bpm)}
                  min={30}
                  max={300}
                  onChange={(v) => handleTempoChange(v, false)}
                  className="!w-11"
                />
              </div>

              {/* Sync Type Selector */}
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[8px] uppercase tracking-widest text-zinc-500">SYNC</span>
                {[
                  { id: 'internal', label: 'INT' },
                  { id: 'link', label: 'LINK' },
                  { id: 'midi', label: 'MIDI' }
                ].map((mode) => {
                  const isActive = syncMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      onClick={() => setSyncMode(mode.id)}
                      title={`Sync mode: ${mode.label}`}
                      className={`px-2 py-1 rounded-md border-[3px] text-[8px] leading-none font-bold tracking-tight transition-none ${
                        isActive
                          ? mode.id === 'link'
                            ? 'bg-amber-400 text-zinc-950 border-amber-300'
                            : 'bg-cyan-400 text-zinc-950 border-cyan-300'
                          : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {mode.label}
                      {mode.id === 'link' && isActive && linkPeers > 0 ? `:${linkPeers}` : ''}
                    </button>
                  );
                })}

                {syncMode === 'link' && (
                  <>
                    <button
                      onClick={() => setLinkRole(prev => prev === 'host' ? 'peer' : 'host')}
                      title={
                        linkRole === 'host'
                          ? 'Acting as Ableton Link Host (authoritative beat & tempo clock). Click to switch to Peer mode.'
                          : 'Acting as Ableton Link Peer (follows external Link Host). Click to become Link Host.'
                      }
                      className={`px-2 py-1 rounded-md border-[3px] text-[8px] leading-none font-bold uppercase transition-none ${
                        linkRole === 'host'
                          ? 'bg-amber-400 text-zinc-950 border-amber-300'
                          : 'text-amber-300 border-amber-500/70 hover:bg-zinc-900'
                      }`}
                    >
                      {linkRole === 'host' ? 'HOST' : 'PEER'}
                    </button>

                    <div className="flex items-center gap-0.5" title={`4-Beat Link Phase (${linkRole === 'host' ? 'Hosting' : 'Synced'})`}>
                      {[0, 1, 2, 3].map((beatIdx) => (
                        <span
                          key={beatIdx}
                          className={`w-1.5 h-1.5 rounded-sm ${
                            Math.floor(linkPhase) === beatIdx
                              ? beatIdx === 0 ? 'bg-amber-400' : 'bg-amber-300'
                              : 'bg-zinc-800'
                          }`}
                        />
                      ))}
                    </div>
                  </>
                )}

                {syncMode !== 'internal' && (
                  <button
                    onClick={() => setLinkStartStopSync(prev => !prev)}
                    title="Toggle Start/Stop Sync"
                    className={`px-2 py-1 rounded-md border-[3px] text-[8px] leading-none font-bold transition-none ${
                      linkStartStopSync
                        ? 'bg-zinc-200 text-zinc-950 border-zinc-100'
                        : 'text-zinc-600 border-zinc-800'
                    }`}
                  >
                    S/S
                  </button>
                )}
              </div>

              {/* MIDI Routing Selector */}
              <div className="relative flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => setIsMidiRoutingOpen(prev => !prev)}
                  title="MIDI I/O Routing"
                  className={`px-2 py-1 rounded-md border-[3px] text-[8px] leading-none font-bold transition-none ${
                    isMidiRoutingOpen
                      ? 'bg-cyan-400 text-zinc-950 border-cyan-300'
                      : 'text-zinc-300 border-zinc-700 hover:border-zinc-500 hover:text-zinc-100'
                  }`}
                >
                  MIDI I/O
                </button>

                {isMidiRoutingOpen && (
                  <div className="absolute top-full right-0 mt-1.5 w-64 bg-[#0c0c0e] border-[3px] border-zinc-600 rounded-xl shadow-[4px_4px_0px_#000] p-2.5 flex flex-col gap-2 z-40 text-[9px]">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400 uppercase tracking-wider font-bold">MIDI OUT</span>
                      <select
                        value={selectedMidiOutputId}
                        onChange={(e) => setSelectedMidiOutputId(e.target.value)}
                        className="bg-[#141418] border-[3px] border-zinc-700 rounded-md px-1.5 py-1 text-zinc-200 w-36 outline-none"
                      >
                        <option value="">NONE</option>
                        {midiOutputs.map(out => (
                          <option key={out.id} value={out.id}>{out.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400 uppercase tracking-wider font-bold">CLK IN</span>
                      <select
                        value={selectedMidiInputId}
                        onChange={(e) => setSelectedMidiInputId(e.target.value)}
                        className="bg-[#141418] border-[3px] border-zinc-700 rounded-md px-1.5 py-1 text-zinc-200 w-36 outline-none"
                      >
                        <option value="">ALL</option>
                        {midiInputs.map(inp => (
                          <option key={inp.id} value={inp.id}>{inp.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center justify-between pt-1.5 border-t-[3px] border-zinc-800">
                      <span className="text-zinc-400 uppercase tracking-wider font-bold">CLK OUT</span>
                      <button
                        onClick={() => setSendMidiClockOut(prev => !prev)}
                        className={`px-2 py-0.5 rounded-md border-[3px] font-bold ${
                          sendMidiClockOut
                            ? 'bg-cyan-400 text-zinc-950 border-cyan-300'
                            : 'text-zinc-500 border-zinc-800'
                        }`}
                      >
                        {sendMidiClockOut ? 'ON' : 'OFF'}
                      </button>
                    </div>

                    {midiError && (
                      <div className="text-[8px] text-amber-400 leading-tight pt-0.5">
                        {midiError}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* PROJECT PATTERN BANK (BOXLESS) */}
              <div className="flex-1 min-w-[200px] flex items-center justify-between gap-1.5">
                <span className="text-[8px] uppercase tracking-widest text-zinc-500 font-bold">PRJ</span>
                <div className="flex items-center gap-1 flex-1 justify-center">
                  {Array.from({ length: 8 }).map((_, slotIdx) => {
                    const hasData = Boolean(projectPatterns[slotIdx]);
                    const isActiveSlot = activeProjectPattern === slotIdx;
                    return (
                      <button
                        key={slotIdx}
                        onClick={() => handleProjectPatternSlot(slotIdx)}
                        title={
                          patternMode === 'save'
                            ? `Overwrite Project Pattern ${slotIdx + 1}`
                            : patternMode === 'clear'
                              ? `Clear Project Pattern ${slotIdx + 1}`
                              : hasData
                                ? `Load Project Pattern ${slotIdx + 1}`
                                : `Save Current Project to Slot ${slotIdx + 1}`
                        }
                        className={`flex-1 max-w-[28px] h-5.5 rounded-md border-[3px] text-[8px] leading-none font-bold flex items-center justify-center transition-none ${
                          isActiveSlot
                            ? 'bg-cyan-400 text-zinc-950 border-cyan-300'
                            : hasData
                              ? 'text-cyan-400 border-cyan-500/80 hover:bg-zinc-900'
                              : 'text-zinc-600 border-zinc-800 hover:text-zinc-300 hover:border-zinc-600'
                        }`}
                      >
                        {slotIdx + 1}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setPatternMode(prev => prev === 'save' ? 'load' : 'save')}
                    title="Arm Save Mode (Click any PRJ or TRK slot to overwrite)"
                    className={`px-1.5 py-1 rounded-md border-[3px] text-[8px] leading-none font-bold uppercase transition-none ${
                      patternMode === 'save'
                        ? 'bg-amber-400 text-zinc-950 border-amber-300'
                        : 'text-zinc-400 border-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    SAV
                  </button>
                  <button
                    onClick={() => setPatternMode(prev => prev === 'clear' ? 'load' : 'clear')}
                    title="Arm Clear Mode (Click any PRJ or TRK slot to erase)"
                    className={`px-1.5 py-1 rounded-md border-[3px] text-[8px] leading-none font-bold uppercase transition-none ${
                      patternMode === 'clear'
                        ? 'bg-rose-500 text-zinc-950 border-rose-400'
                        : 'text-zinc-500 border-zinc-800 hover:text-zinc-300'
                    }`}
                  >
                    CLR
                  </button>
                </div>
              </div>
            </div>

            {/* TOP: 8 ROTARY KNOBS & TRACK PATTERN CONTROLS (BOXLESS) */}
            <div className="w-full py-0.5 shrink-0">
              <div className="flex flex-nowrap items-center justify-between text-[8px] uppercase tracking-widest text-zinc-500 mb-1.5 gap-1.5">
                <div className="flex flex-nowrap items-center gap-2.5 shrink-0">
                  <span style={{ color: currentTrack.color.hex }} className="font-bold">
                    S:{selectedStepIndex !== null ? selectedStepIndex + 1 : '--'}
                  </span>
                  {selectedStepIndex !== null && (
                    <button
                      onClick={() => setSelectedStepIndex(null)}
                      className="text-zinc-500 hover:text-zinc-200 underline uppercase"
                    >
                      [X]
                    </button>
                  )}

                  {/* Global Note Density + Dice Trigger */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={randomizeNotesAcrossTrack}
                      title={`Randomize Note triggers across ${currentTrack.name} (${noteDensity}% density)`}
                      className="flex items-center gap-1 text-zinc-400 hover:text-amber-400 transition-none cursor-pointer"
                    >
                      <DiceIcon className="w-2.5 h-2.5" />
                      <span>NT</span>
                    </button>
                    <NumberDragger
                      micro
                      value={noteDensity}
                      min={0}
                      max={100}
                      onChange={setNoteDensity}
                      format={(v) => `${v}%`}
                    />
                  </div>

                  {/* Global Para/CC Density + All-8 Dice Trigger */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={randomizeAllEightKnobsAcrossTrack}
                      title={`Randomize all 8 Para/CC knobs across ${currentTrack.name} (${paraCcDensity}% density)`}
                      className="flex items-center gap-1 text-zinc-400 hover:text-cyan-400 transition-none cursor-pointer"
                    >
                      <DiceIcon className="w-2.5 h-2.5" />
                      <span>CC</span>
                    </button>
                    <NumberDragger
                      micro
                      value={paraCcDensity}
                      min={0}
                      max={100}
                      onChange={setParaCcDensity}
                      format={(v) => `${v}%`}
                    />
                  </div>

                  {/* Continuous vs Step-Locked CC Output Toggle */}
                  <button
                    type="button"
                    onClick={() => setContinuousCCOutput(prev => !prev)}
                    title={
                      continuousCCOutput
                        ? "Continuous Para/CC Output: Sends CC on every step (click for Step-Locked mode)"
                        : "Step-Locked Para/CC Output: Sends CC only on active note steps (click for Continuous mode)"
                    }
                    className={`px-2 py-0.5 rounded-md border-[3px] text-[8px] leading-none font-bold uppercase transition-none cursor-pointer ${
                      continuousCCOutput
                        ? 'bg-cyan-400 text-zinc-950 border-cyan-300'
                        : 'text-zinc-400 border-zinc-800 hover:text-zinc-200 hover:border-zinc-600'
                    }`}
                  >
                    {continuousCCOutput ? 'CC:CONT' : 'CC:STEP'}
                  </button>
                </div>

                {/* PER-TRACK PATTERN SLOTS (BOXLESS) */}
                <div className="flex items-center gap-1">
                  <span style={{ color: currentTrack.color.hex }} className="font-bold mr-0.5">
                    {currentTrack.name}
                  </span>
                  {Array.from({ length: 8 }).map((_, slotIdx) => {
                    const hasData = Boolean(trackPatterns[currentTrack.id]?.[slotIdx]);
                    const isActiveSlot = activeTrackPatterns[currentTrack.id] === slotIdx;
                    return (
                      <button
                        key={slotIdx}
                        onClick={() => handleTrackPatternSlot(slotIdx)}
                        title={
                          patternMode === 'save'
                            ? `Overwrite ${currentTrack.name} Pattern ${slotIdx + 1}`
                            : patternMode === 'clear'
                              ? `Clear ${currentTrack.name} Pattern ${slotIdx + 1}`
                              : hasData
                                ? `Load ${currentTrack.name} Pattern ${slotIdx + 1}`
                                : `Save ${currentTrack.name} to Pattern ${slotIdx + 1}`
                        }
                        style={{
                          backgroundColor: isActiveSlot ? currentTrack.color.hex : undefined,
                          borderColor: isActiveSlot || hasData ? currentTrack.color.hex : undefined,
                          color: isActiveSlot
                            ? '#09090b'
                            : hasData
                              ? currentTrack.color.hex
                              : undefined
                        }}
                        className={`w-5.5 h-5.5 rounded-md border-[3px] text-[8px] leading-none font-bold flex items-center justify-center transition-none ${
                          !isActiveSlot && !hasData
                            ? 'text-zinc-600 border-zinc-800 hover:text-zinc-300 hover:border-zinc-600'
                            : ''
                        }`}
                      >
                        {slotIdx + 1}
                      </button>
                    );
                  })}
                </div>

                <span style={{ color: currentTrack.color.hex }} className="font-bold">
                  CH{currentTrack.channel + 1}
                </span>
              </div>

              <div className="grid grid-cols-8 gap-2.5 items-start">
                {/* Column 1: Pitch */}
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => randomizeKnobAcrossTrack('pitch')}
                    title={`Randomize Pitch across ${currentTrack.name} steps`}
                    style={{ color: currentTrack.color.hex }}
                    className="mb-1 px-1.5 py-0.5 rounded-md border-2 border-zinc-800 hover:border-zinc-500 flex items-center justify-center transition-none cursor-pointer"
                  >
                    <StepLockIcon type="pitch" />
                  </button>
                  <div className={`flex flex-col items-center ${selectedStepIndex !== null ? 'opacity-100' : 'opacity-35 pointer-events-none'}`}>
                    <Knob
                      size="sm"
                      value={currentStepData ? (currentStepData.pitch || 0) : 0}
                      min={-24} max={24}
                      onChange={(v) => updateStepParam('pitch', v)}
                      format={(v) => `${v > 0 ? '+' : ''}${v}`}
                      hexColor={currentTrack.color.hex}
                    />
                  </div>
                </div>

                {/* Column 2: Velocity */}
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => randomizeKnobAcrossTrack('velocity')}
                    title={`Randomize Velocity across ${currentTrack.name} steps`}
                    style={{ color: currentTrack.color.hex }}
                    className="mb-1 px-1.5 py-0.5 rounded-md border-2 border-zinc-800 hover:border-zinc-500 flex items-center justify-center transition-none cursor-pointer"
                  >
                    <StepLockIcon type="velocity" />
                  </button>
                  <div className={`flex flex-col items-center ${selectedStepIndex !== null ? 'opacity-100' : 'opacity-35 pointer-events-none'}`}>
                    <Knob
                      size="sm"
                      value={currentStepData ? currentStepData.velocity : 100}
                      min={0} max={127}
                      onChange={(v) => updateStepParam('velocity', v)}
                      hexColor={currentTrack.color.hex}
                    />
                  </div>
                </div>

                {/* Column 3: Probability */}
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => randomizeKnobAcrossTrack('probability')}
                    title={`Randomize Probability across ${currentTrack.name} steps`}
                    style={{ color: currentTrack.color.hex }}
                    className="mb-1 px-1.5 py-0.5 rounded-md border-2 border-zinc-800 hover:border-zinc-500 flex items-center justify-center transition-none cursor-pointer"
                  >
                    <StepLockIcon type="probability" />
                  </button>
                  <div className={`flex flex-col items-center ${selectedStepIndex !== null ? 'opacity-100' : 'opacity-35 pointer-events-none'}`}>
                    <Knob
                      size="sm"
                      value={currentStepData ? currentStepData.probability : 100}
                      min={0} max={100}
                      onChange={(v) => updateStepParam('probability', v)}
                      format={(v) => `${v}%`}
                      hexColor={currentTrack.color.hex}
                    />
                  </div>
                </div>

                {/* Column 4: Ratchet */}
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => randomizeKnobAcrossTrack('ratchet')}
                    title={`Randomize Ratchet across ${currentTrack.name} steps`}
                    style={{ color: currentTrack.color.hex }}
                    className="mb-1 px-1.5 py-0.5 rounded-md border-2 border-zinc-800 hover:border-zinc-500 flex items-center justify-center transition-none cursor-pointer"
                  >
                    <StepLockIcon type="ratchet" />
                  </button>
                  <div className={`flex flex-col items-center ${selectedStepIndex !== null ? 'opacity-100' : 'opacity-35 pointer-events-none'}`}>
                    <Knob
                      size="sm"
                      value={currentStepData ? currentStepData.ratchet : 1}
                      min={1} max={8}
                      onChange={(v) => updateStepParam('ratchet', v)}
                      format={(v) => `x${v}`}
                      hexColor={currentTrack.color.hex}
                    />
                  </div>
                </div>

                {/* Columns 5-8: 4 Customizable MIDI CC Knobs */}
                {currentTrack.ccConfigs.map((cfg, slotIdx) => {
                  const stepLockVal = currentStepData?.ccLocks?.[slotIdx];
                  const isLocked = selectedStepIndex !== null && stepLockVal !== null && stepLockVal !== undefined;
                  const displayValue = isLocked ? stepLockVal : cfg.defaultValue;
                  const isCcMenuOpen = openCcMenuSlot === slotIdx;

                  return (
                    <div key={slotIdx} className="flex flex-col items-center relative">
                      <button
                        type="button"
                        onClick={() => randomizeKnobAcrossTrack('cc', slotIdx)}
                        title={`Randomize CC ${cfg.cc} across ${currentTrack.name} steps`}
                        style={{ color: currentTrack.color.hex }}
                        className="mb-1 px-1.5 py-0.5 rounded-md border-2 border-zinc-800 hover:border-zinc-500 text-[8px] leading-none uppercase tracking-wider font-bold flex items-center justify-center transition-none cursor-pointer"
                      >
                        {`CC${cfg.cc}`}
                      </button>
                      <Knob
                        size="sm"
                        value={displayValue}
                        min={0}
                        max={127}
                        onChange={(v) => handleCCKnobChange(slotIdx, v)}
                        hexColor={currentTrack.color.hex}
                      />
                      <div className="flex items-center justify-center gap-1 mt-1 relative">
                        <span
                          style={{ color: currentTrack.color.hex }}
                          className="text-[8px] leading-none font-bold uppercase select-none"
                        >
                          {`CC${cfg.cc}`}
                        </span>
                        <button
                          type="button"
                          onClick={() => setOpenCcMenuSlot(prev => prev === slotIdx ? null : slotIdx)}
                          title={`Change target MIDI CC for slot ${slotIdx + 1}`}
                          style={{
                            color: isCcMenuOpen ? '#09090b' : currentTrack.color.hex,
                            borderColor: currentTrack.color.hex,
                            backgroundColor: isCcMenuOpen ? currentTrack.color.hex : '#111115'
                          }}
                          className="w-4 h-4 rounded-md border-2 text-[8px] leading-none font-bold flex items-center justify-center transition-none cursor-pointer"
                        >
                          v
                        </button>
                        {isLocked && (
                          <button
                            onClick={() => clearStepCCLock(slotIdx)}
                            title="Clear step CC lock"
                            style={{
                              color: '#09090b',
                              backgroundColor: currentTrack.color.hex
                            }}
                            className="w-3.5 h-3.5 rounded-sm text-[8px] flex items-center justify-center font-bold shrink-0"
                          >
                            X
                          </button>
                        )}

                        {isCcMenuOpen && (
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-32 bg-[#0c0c0e] border-[3px] border-zinc-600 rounded-xl shadow-[3px_3px_0px_#000] p-1.5 flex flex-col gap-1 z-40">
                            <div className="flex items-center justify-between text-[8px] text-zinc-400 uppercase font-bold">
                              <span>CC #</span>
                              <input
                                type="number"
                                min={0}
                                max={127}
                                value={cfg.cc}
                                onChange={(e) => {
                                  const parsed = parseInt(e.target.value, 10);
                                  if (!Number.isNaN(parsed)) {
                                    updateTrackCCNumber(slotIdx, Math.max(0, Math.min(127, parsed)));
                                  }
                                }}
                                className="w-12 bg-[#141418] border-2 border-zinc-700 focus:border-zinc-400 rounded-md px-1 py-0.5 text-[8px] leading-none text-zinc-100 text-center outline-none"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-1 pt-0.5 border-t-2 border-zinc-800">
                              {[
                                { label: 'CUT 74', cc: 74 },
                                { label: 'RES 71', cc: 71 },
                                { label: 'ATK 73', cc: 73 },
                                { label: 'REL 72', cc: 72 },
                                { label: 'MOD 1', cc: 1 },
                                { label: 'EXP 11', cc: 11 }
                              ].map(preset => (
                                <button
                                  key={preset.cc}
                                  type="button"
                                  onClick={() => {
                                    updateTrackCCNumber(slotIdx, preset.cc);
                                    setOpenCcMenuSlot(null);
                                  }}
                                  style={{
                                    color: cfg.cc === preset.cc ? '#09090b' : currentTrack.color.hex,
                                    backgroundColor: cfg.cc === preset.cc ? currentTrack.color.hex : 'transparent'
                                  }}
                                  className="px-1 py-0.5 rounded-md border border-zinc-800 hover:border-zinc-600 text-[7px] leading-none font-bold uppercase text-left cursor-pointer"
                                >
                                  {preset.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* MIDDLE: TRACK SETTINGS (ABOVE TRACK), 8 TRACK SELECTORS, PG/VW BAR & 16 STEP PADS */}
            <div className="flex flex-col justify-start gap-2 shrink-0">
              {/* TRACK SETTINGS GEAR & INLINE CONFIGURATION ABOVE SELECTED TRACK */}
              <div className="w-full shrink-0 relative">
                {/* Boxless Inline Track Configuration Strip Above Selected Track */}
                {isConfigOpen && (
                  <div className="mb-1 pb-1.5 border-b-[3px] border-zinc-800 w-full flex flex-wrap items-center justify-center gap-3 text-[8px] leading-none z-30">
                    <div className="flex items-center gap-1">
                      <span className="uppercase tracking-wider text-zinc-500">CH</span>
                      <NumberDragger
                        micro
                        value={currentTrack.channel + 1}
                        min={1} max={16}
                        onChange={(v) => updateTrack(currentTrack.id, 'channel', v - 1)}
                      />
                    </div>

                    <div className="flex items-center gap-1">
                      <span className="uppercase tracking-wider text-zinc-500">NT</span>
                      <NumberDragger
                        micro
                        value={currentTrack.note}
                        min={0} max={127}
                        onChange={(v) => updateTrack(currentTrack.id, 'note', v)}
                        format={formatNote}
                      />
                    </div>

                    <div className="flex items-center gap-1">
                      <span className="uppercase tracking-wider text-zinc-500">LN</span>
                      <NumberDragger
                        micro
                        value={currentTrack.length}
                        min={1} max={MAX_STEPS}
                        onChange={(v) => updateTrack(currentTrack.id, 'length', v)}
                      />
                    </div>

                    <div className="flex items-center gap-1">
                      <span className="uppercase tracking-wider text-zinc-500">DV</span>
                      <select
                        value={currentTrack.division}
                        onChange={(e) => updateTrack(currentTrack.id, 'division', parseFloat(e.target.value))}
                        className="bg-transparent border-b-2 border-zinc-700 hover:border-zinc-500 rounded-none px-1 py-0.5 text-zinc-200 text-[8px] leading-none outline-none cursor-pointer"
                      >
                        <option value={1} className="bg-[#09090b]">1/4</option>
                        <option value={0.5} className="bg-[#09090b]">1/8</option>
                        <option value={0.25} className="bg-[#09090b]">1/16</option>
                        <option value={0.125} className="bg-[#09090b]">1/32</option>
                        <option value={0.3333} className="bg-[#09090b]">1/8T</option>
                        <option value={0.1666} className="bg-[#09090b]">1/16T</option>
                      </select>
                    </div>

                    {/* TRACK COLOR DROP-DOWN SELECTOR */}
                    <div className="relative flex items-center gap-1">
                      <span className="uppercase tracking-wider text-zinc-500">CL</span>
                      <button
                        type="button"
                        onClick={() => {
                          setCustomHexInput(currentTrack.color.hex);
                          setIsColorDropupOpen(prev => !prev);
                        }}
                        style={{
                          borderColor: isColorDropupOpen ? currentTrack.color.hex : undefined,
                          color: currentTrack.color.hex
                        }}
                        className="flex items-center gap-1 border-b-2 border-zinc-700 hover:border-zinc-500 rounded-none px-1 py-0.5 text-[8px] leading-none cursor-pointer"
                      >
                        <span
                          className="w-2 h-2 rounded-none shrink-0"
                          style={{ backgroundColor: currentTrack.color.hex }}
                        />
                        <span>{currentTrack.color.name}</span>
                      </button>

                      {isColorDropupOpen && (
                        <div className="absolute top-full right-0 mt-1.5 w-36 bg-[#0c0c0e] border-[3px] border-zinc-600 rounded-xl shadow-[3px_3px_0px_#000] p-1.5 flex flex-col gap-1 z-40">
                          {TRACK_COLORS.map((c) => {
                            const isActiveColor = currentTrack.color.hex.toLowerCase() === c.hex.toLowerCase();
                            return (
                              <button
                                key={c.name}
                                type="button"
                                onClick={() => {
                                  updateTrack(currentTrack.id, 'color', c);
                                  setCustomHexInput(c.hex);
                                  setIsColorDropupOpen(false);
                                }}
                                style={{
                                  color: c.hex,
                                  backgroundColor: isActiveColor ? '#18181f' : undefined
                                }}
                                className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded-md text-[8px] leading-none text-left hover:bg-zinc-900 transition-none cursor-pointer"
                              >
                                <span
                                  className="w-2 h-2 rounded-sm shrink-0"
                                  style={{ backgroundColor: c.hex }}
                                />
                                <span className="font-bold">{c.name}</span>
                              </button>
                            );
                          })}

                          {/* Custom Hex Color Picker & Text Input */}
                          <div className="pt-1.5 mt-0.5 border-t-[3px] border-zinc-800 flex items-center gap-1">
                            <label
                              title="Open Color Picker"
                              className="w-5 h-5 rounded-md border-[3px] border-zinc-600 shrink-0 cursor-pointer relative overflow-hidden"
                              style={{ backgroundColor: currentTrack.color.hex }}
                            >
                              <input
                                type="color"
                                value={currentTrack.color.hex}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setCustomHexInput(val);
                                  applyCustomTrackHex(currentTrack.id, val);
                                }}
                                className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                              />
                            </label>
                            <input
                              type="text"
                              maxLength={7}
                              value={customHexInput}
                              placeholder="#FF00AA"
                              onChange={(e) => {
                                const val = e.target.value;
                                setCustomHexInput(val);
                                applyCustomTrackHex(currentTrack.id, val);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  applyCustomTrackHex(currentTrack.id, customHexInput);
                                  setIsColorDropupOpen(false);
                                }
                              }}
                              className="w-full bg-[#141418] border-[3px] border-zinc-700 focus:border-zinc-400 rounded-md px-1 py-0.5 text-[8px] leading-none text-zinc-200 uppercase outline-none"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Gear Toggle Button Directly Above Active Track Selector */}
                <div className="grid grid-cols-8 gap-2.5 w-full">
                  {tracks.map((track) => {
                    const isSelected = selectedTrackId === track.id;
                    return (
                      <div key={track.id} className="h-4 flex items-center justify-center w-full">
                        {isSelected && (
                          <button
                            onClick={() => {
                              setIsConfigOpen(prev => !prev);
                              setIsColorDropupOpen(false);
                            }}
                            style={{
                              color: isConfigOpen ? '#09090b' : currentTrack.color.hex,
                              borderColor: currentTrack.color.hex,
                              backgroundColor: isConfigOpen ? currentTrack.color.hex : 'transparent'
                            }}
                            title={`Configure ${currentTrack.name}`}
                            className="w-[56%] h-4 rounded-md border-[3px] flex items-center justify-center transition-none cursor-pointer"
                          >
                            <PixelGearIcon className="w-2 h-2" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 8 TRACK SELECTORS ROW (75% SCALED & CENTERED ABOVE EACH COLUMN) */}
              <div className="grid grid-cols-8 gap-2.5 w-full">
                {tracks.map((track) => {
                  const isSelected = selectedTrackId === track.id;
                  return (
                    <div
                      key={track.id}
                      onClick={() => {
                        if (selectedTrackId !== track.id) {
                          setSelectedTrackId(track.id);
                          setSelectedStepIndex(null);
                          setCurrentPage(0);
                          setIsConfigOpen(false);
                          setIsColorDropupOpen(false);
                        }
                      }}
                      style={{
                        color: track.color.hex,
                        backgroundColor: isSelected ? `rgba(${track.color.rgb}, 0.18)` : undefined,
                        borderColor: isSelected ? track.color.hex : undefined
                      }}
                      className={`relative place-self-center w-[75%] h-[57px] rounded-xl border-4 p-1.5 flex flex-col justify-between cursor-pointer transition-none overflow-hidden
                        ${isSelected ? 'opacity-100' : 'border-zinc-800 hover:border-zinc-600 opacity-75 hover:opacity-100'}
                      `}
                    >
                      <div className="w-full flex items-center justify-between">
                        <span className="text-[7px] font-bold opacity-75 leading-none">
                          C{track.channel + 1}
                        </span>
                        <span className="text-[7px] font-bold opacity-65 leading-none">
                          {formatNote(track.note)}
                        </span>
                      </div>

                      <span className="font-bold tracking-wider text-xs self-center my-auto leading-none">
                        {track.name}
                      </span>

                      <div className="w-full flex items-center">
                        <div
                          style={{
                            backgroundColor: isSelected ? track.color.hex : undefined
                          }}
                          className={`h-1 w-full rounded-full ${!isSelected ? 'bg-zinc-800' : ''}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 8-COLUMN × 2-ROW STEP GRID */}
              <div className="grid grid-cols-8 grid-rows-2 gap-2.5 w-full">
                {visibleSteps.map((step, localIdx) => {
                  const idx = pageStartIndex + localIdx;
                  const isPlayingStep = playingSteps[currentTrack.id] === idx;
                  const isSelected = selectedStepIndex === idx;
                  const isOutsideLength = idx >= currentTrack.length;
                  const trackColor = currentTrack.color;

                  const hasCCLock = step.ccLocks && step.ccLocks.some(v => v !== null && v !== undefined);
                  const hasPlock = (step.pitch || 0) !== 0 || step.probability < 100 || step.ratchet > 1 || step.velocity !== 100 || hasCCLock;

                  const isParamViewActive = activeParamView !== null;
                  const { ratio: paramFillRatio, formatted: paramFormatted } = getStepViewValueAndRatio(currentTrack, step, activeParamView);
                  const fillPercent = Math.max(0, Math.min(100, paramFillRatio * 100));
                  const isPadFilled = isParamViewActive ? fillPercent > 0 : step.active;

                  return (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: !isParamViewActive && step.active ? `rgba(${trackColor.rgb}, 0.22)` : undefined,
                        borderColor: isSelected
                          ? '#ffffff'
                          : isParamViewActive
                            ? (fillPercent > 0 ? trackColor.hex : undefined)
                            : (step.active ? trackColor.hex : undefined),
                        boxShadow: isSelected ? `inset 0 0 0 2px ${trackColor.hex}` : undefined
                      }}
                      className={`relative w-full h-[76px] rounded-xl border-4 transition-none flex flex-col justify-end p-1.5 overflow-hidden touch-none
                        ${isParamViewActive ? 'cursor-ns-resize border-zinc-800' : 'cursor-pointer'}
                        ${isOutsideLength ? 'opacity-20 pointer-events-none' : ''}
                        ${!isParamViewActive && !step.active ? 'border-zinc-800 hover:border-zinc-600' : ''}
                      `}
                      onPointerDown={(e) => {
                        if (isParamViewActive) {
                          e.currentTarget.setPointerCapture(e.pointerId);
                          setDraggingPadStep(idx);
                          handlePadPointerInteraction(e, currentTrack.id, idx);
                        }
                      }}
                      onPointerMove={(e) => {
                        if (isParamViewActive && draggingPadStep === idx) {
                          handlePadPointerInteraction(e, currentTrack.id, idx);
                        }
                      }}
                      onPointerUp={(e) => {
                        if (draggingPadStep === idx) {
                          e.currentTarget.releasePointerCapture(e.pointerId);
                          setDraggingPadStep(null);
                        }
                      }}
                      onClick={() => {
                        if (!isParamViewActive) {
                          toggleStep(currentTrack.id, idx);
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setSelectedStepIndex(idx);
                      }}
                    >
                      {isParamViewActive && fillPercent > 0 && (
                        <div
                          style={{
                            height: `${fillPercent}%`,
                            backgroundColor: trackColor.hex,
                            opacity: step.active ? 0.95 : 0.45
                          }}
                          className="absolute left-0 right-0 bottom-0 pointer-events-none"
                        />
                      )}

                      <span
                        style={{
                          color: isParamViewActive
                            ? (fillPercent > 65 ? '#09090b' : (fillPercent > 0 ? trackColor.hex : undefined))
                            : (step.active ? trackColor.hex : undefined)
                        }}
                        className={`text-[9px] absolute top-1.5 left-1.5 font-bold z-10 leading-none ${!isPadFilled ? 'text-zinc-600' : ''}`}
                      >
                        {idx + 1}
                      </span>

                      {isParamViewActive && (
                        <span
                          style={{
                            color: fillPercent > 45 ? '#09090b' : (fillPercent > 0 ? trackColor.hex : '#71717a')
                          }}
                          className="text-[11px] font-bold self-center my-auto z-10 pointer-events-none"
                        >
                          {paramFormatted}
                        </span>
                      )}

                      {isPlayingStep && !isOutsideLength && (
                        <div className="absolute inset-0 bg-white/25 pointer-events-none z-20" />
                      )}

                      <div className="w-full flex justify-between items-end z-10">
                        <div
                          style={{
                            backgroundColor: step.active
                              ? (isParamViewActive && fillPercent > 20 ? '#09090b' : trackColor.hex)
                              : undefined
                          }}
                          className={`h-1.5 flex-1 mr-1 rounded-full ${!step.active ? 'bg-zinc-800' : ''}`}
                        />
                        <div className={`w-1.5 h-1.5 rounded-full ${hasPlock && step.active ? (isParamViewActive && fillPercent > 20 ? 'bg-zinc-950' : 'bg-white') : 'bg-transparent'}`} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* BOTTOMMOST: PAGE NAVIGATION & PARAMETER VIEW BAR */}
              <div className="grid grid-cols-2 gap-2.5 shrink-0 w-full">
                <div className="w-full flex items-center justify-between gap-1.5">
                  <span className="text-[8px] uppercase tracking-widest text-zinc-500 shrink-0">PG</span>
                  <div className="flex-1 grid grid-cols-8 gap-1">
                    {Array.from({ length: NUM_PAGES }).map((_, pageIdx) => {
                      const isCurrentPage = currentPage === pageIdx;
                      const pageStart = pageIdx * STEPS_PER_PAGE;
                      const pageEnd = pageStart + STEPS_PER_PAGE;
                      const isPageInTrackLength = pageStart < currentTrack.length;
                      const playingStep = playingSteps[currentTrack.id];
                      const isPlayheadOnPage = isPlaying && playingStep !== undefined && playingStep >= pageStart && playingStep < pageEnd;
                      const hasActiveStepsOnPage = currentTrack.steps
                        .slice(pageStart, Math.min(pageEnd, currentTrack.length))
                        .some(s => s.active);

                      return (
                        <button
                          key={pageIdx}
                          onClick={() => setCurrentPage(pageIdx)}
                          style={{
                            backgroundColor: isCurrentPage ? invertedTrackHex : 'transparent',
                            borderColor: isCurrentPage ? invertedTrackHex : currentTrack.color.hex,
                            color: isCurrentPage ? '#09090b' : currentTrack.color.hex
                          }}
                          className={`relative w-full py-1 rounded-md border-[3px] text-[9px] leading-none font-bold tracking-tight transition-none flex items-center justify-center gap-0.5
                            ${!isPageInTrackLength ? 'opacity-30' : (!isCurrentPage ? 'opacity-85 hover:opacity-100' : '')}
                          `}
                          title={`Steps ${pageStart + 1} - ${pageEnd}`}
                        >
                          <span>{pageIdx + 1}</span>
                          <span
                            style={{
                              backgroundColor: isPlayheadOnPage
                                ? (isCurrentPage ? '#09090b' : '#ffffff')
                                : hasActiveStepsOnPage
                                  ? (isCurrentPage ? '#09090b' : currentTrack.color.hex)
                                  : 'transparent'
                            }}
                            className="w-1 h-1 rounded-full"
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* BOXLESS 8 PARAMETER VIEW ICONS */}
                <div className="w-full flex items-center justify-between gap-1.5">
                  <span className="text-[8px] uppercase tracking-widest text-zinc-500 shrink-0">VW</span>
                  <div className="flex-1 grid grid-cols-8 gap-1">
                    {paramViews.map((pv) => {
                      const isViewToggled = activeParamView === pv.id;
                      return (
                        <button
                          key={pv.id}
                          title={`${pv.label}${pv.ccIdx !== undefined ? ` (CC ${currentTrack.ccConfigs[pv.ccIdx].cc})` : ''}`}
                          onClick={() => setActiveParamView(prev => prev === pv.id ? null : pv.id)}
                          style={{
                            backgroundColor: isViewToggled ? invertedTrackHex : 'transparent',
                            borderColor: isViewToggled ? invertedTrackHex : currentTrack.color.hex,
                            color: isViewToggled ? '#09090b' : currentTrack.color.hex
                          }}
                          className={`w-full py-1 rounded-md border-[3px] text-[8px] leading-none font-bold tracking-tight transition-none flex items-center justify-center truncate
                            ${!isViewToggled ? 'opacity-85 hover:opacity-100' : ''}
                          `}
                        >
                          {pv.iconType ? (
                            <span className="w-3 h-3 flex items-center justify-center [&>svg]:w-3 [&>svg]:h-3">
                              <StepLockIcon type={pv.iconType} />
                            </span>
                          ) : (
                            pv.label
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}