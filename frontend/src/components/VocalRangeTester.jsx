import { useEffect, useRef, useState } from "react";
import { detectPitch, frequencyToNote } from "../lib/pitch";
import { saveVocalProfile } from "../lib/api";

const STABLE_NOTE_FRAMES = 8;
const TEST_GUIDANCE_ITEMS = [
  "\u4e0d\u8981\u76f4\u63a5\u8bf4\u8bdd\uff0c\u5c3d\u91cf\u7528\u201c\u554a\u201d\u3001\u201c\u5594\u201d\u6216\u201c\u55ef\u201d\u8fd9\u79cd\u7a33\u5b9a\u957f\u97f3\u6765\u5531\u3002",
  "\u5148\u4ece\u6700\u8212\u670d\u7684\u4e2d\u97f3\u5f00\u59cb\uff0c\u6bcf\u4e2a\u97f3\u4fdd\u6301 1 \u5230 2 \u79d2\uff0c\u518d\u6162\u6162\u5f80\u4f4e\u97f3\u548c\u9ad8\u97f3\u5ef6\u4f38\u3002",
  "\u7b49\u53f3\u4fa7\u51fa\u73b0\u201c\u6700\u4f4e\u7a33\u5b9a\u97f3\u201d\u548c\u201c\u6700\u9ad8\u7a33\u5b9a\u97f3\u201d\u540e\uff0c\u518d\u70b9\u201c\u4fdd\u5b58\u6211\u7684\u97f3\u57df\u201d\u3002",
];

const INITIAL_STABLE_NOTE = {
  frames: 0,
  frequencyTotal: 0,
  midi: null,
  noteName: "",
};

function formatFrequency(frequency) {
  return frequency ? `${frequency.toFixed(1)} Hz` : "--";
}

function ResultCard({ label, note, accentClass }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
      <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{label}</p>
      <div className="mt-3 space-y-1">
        <p className={`text-3xl font-semibold ${accentClass}`}>
          {note?.noteName ?? "--"}
        </p>
        <p className="text-sm text-slate-300">
          {note ? formatFrequency(note.frequency) : "\u7b49\u5f85\u7a33\u5b9a\u97f3\u9ad8"}
        </p>
      </div>
    </div>
  );
}

export function VocalRangeTester({ onProfileSaved, savedProfile }) {
  const [isListening, setIsListening] = useState(false);
  const [permissionError, setPermissionError] = useState("");
  const [currentPitch, setCurrentPitch] = useState(null);
  const [range, setRange] = useState({ highest: null, lowest: null });
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const dataBufferRef = useRef(null);
  const frameIdRef = useRef(null);
  const streamRef = useRef(null);
  const stableNoteRef = useRef(INITIAL_STABLE_NOTE);

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, []);

  function resetStableNote() {
    stableNoteRef.current = { ...INITIAL_STABLE_NOTE };
  }

  function stopListening() {
    if (frameIdRef.current) {
      cancelAnimationFrame(frameIdRef.current);
      frameIdRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    dataBufferRef.current = null;
    resetStableNote();
    setCurrentPitch(null);
    setIsListening(false);
  }

  function commitStableNote(note) {
    setRange((previousRange) => {
      let hasChanged = false;

      const nextRange = {
        highest: previousRange.highest,
        lowest: previousRange.lowest,
      };

      if (!previousRange.lowest || note.midi < previousRange.lowest.midi) {
        nextRange.lowest = note;
        hasChanged = true;
      }

      if (!previousRange.highest || note.midi > previousRange.highest.midi) {
        nextRange.highest = note;
        hasChanged = true;
      }

      return hasChanged ? nextRange : previousRange;
    });
  }

  function updateStableRange(note) {
    const candidate = stableNoteRef.current;

    if (candidate.midi === note.midi) {
      candidate.frames += 1;
      candidate.frequencyTotal += note.frequency;
    } else {
      stableNoteRef.current = {
        frames: 1,
        frequencyTotal: note.frequency,
        midi: note.midi,
        noteName: note.noteName,
      };
      return;
    }

    if (candidate.frames >= STABLE_NOTE_FRAMES) {
      const averageFrequency = candidate.frequencyTotal / candidate.frames;
      const stableNote = frequencyToNote(averageFrequency);

      if (stableNote) {
        commitStableNote(stableNote);
      }
    }
  }

  function analyzeFrame() {
    const analyser = analyserRef.current;
    const audioContext = audioContextRef.current;
    const dataBuffer = dataBufferRef.current;

    if (!analyser || !audioContext || !dataBuffer) {
      return;
    }

    analyser.getFloatTimeDomainData(dataBuffer);

    const frequency = detectPitch(dataBuffer, audioContext.sampleRate);

    if (!frequency) {
      resetStableNote();
      setCurrentPitch(null);
      frameIdRef.current = requestAnimationFrame(analyzeFrame);
      return;
    }

    const note = frequencyToNote(frequency);

    setCurrentPitch(note);

    if (note) {
      updateStableRange(note);
    }

    frameIdRef.current = requestAnimationFrame(analyzeFrame);
  }

  async function startListening() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionError("\u5f53\u524d\u6d4f\u89c8\u5668\u4e0d\u652f\u6301\u9ea6\u514b\u98ce\u91c7\u96c6\u3002");
      return;
    }

    stopListening();
    setPermissionError("");
    setProfileError("");
    setSaveMessage("");
    setRange({ highest: null, lowest: null });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        },
      });

      const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;

      if (!AudioContextClass) {
        throw new Error("AudioContext is not supported.");
      }

      const audioContext = new AudioContextClass();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);

      await audioContext.resume();

      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.1;

      source.connect(analyser);

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      dataBufferRef.current = new Float32Array(analyser.fftSize);

      setIsListening(true);
      frameIdRef.current = requestAnimationFrame(analyzeFrame);
    } catch (error) {
      setPermissionError(
        "\u672a\u80fd\u83b7\u53d6\u9ea6\u514b\u98ce\u6743\u9650\uff0c\u8bf7\u68c0\u67e5\u6d4f\u89c8\u5668\u8bbe\u7f6e\u540e\u91cd\u8bd5\u3002",
      );
      stopListening();
    }
  }

  async function handleSaveProfile() {
    if (!range.lowest || !range.highest) {
      setProfileError("\u8bf7\u5148\u5b8c\u6210\u4e00\u6b21\u6709\u6548\u7684\u97f3\u57df\u6d4b\u8bd5\u3002");
      return;
    }

    setIsSavingProfile(true);
    setProfileError("");
    setSaveMessage("");

    try {
      const profile = await saveVocalProfile(range);
      onProfileSaved(profile);
      setSaveMessage("\u97f3\u57df\u6863\u6848\u5df2\u4fdd\u5b58\uff0c\u53ef\u4ee5\u5f00\u59cb\u4e0a\u4f20\u6b4c\u66f2\u4e86\u3002");
    } catch (requestError) {
      setProfileError(requestError.message);
    } finally {
      setIsSavingProfile(false);
    }
  }

  return (
    <section className="rounded-[2rem] border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/40 sm:p-8">
      <div className="flex flex-col gap-6">
        <div className="space-y-4">
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-400">
            Vocal Range Test
          </p>
          <div className="space-y-3">
            <h2 className="text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">
              {"\u5b9e\u65f6\u68c0\u6d4b\u4f60\u5f53\u524d\u5531\u51fa\u7684\u97f3\u540d\uff0c\u5e76\u8bb0\u5f55\u7a33\u5b9a\u7684\u6700\u9ad8\u97f3\u548c\u6700\u4f4e\u97f3"}
            </h2>
            <p className="max-w-3xl text-base text-slate-300">
              {"\u70b9\u51fb\u6309\u94ae\u540e\u4f1a\u8bf7\u6c42\u9ea6\u514b\u98ce\u6743\u9650\u3002\u7ec4\u4ef6\u4f1a\u6301\u7eed\u5206\u6790\u8f93\u5165\u9891\u7387\uff0c\u628a Hz \u8f6c\u6210\u97f3\u540d\uff0c\u5e76\u7528\u8fde\u7eed\u7a33\u5b9a\u7684\u7ed3\u679c\u6765\u66f4\u65b0\u4f60\u7684\u97f3\u57df\u8303\u56f4\u3002"}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={isListening ? stopListening : startListening}
              className="inline-flex items-center justify-center rounded-full bg-cyan-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
            >
              {isListening
                ? "\u505c\u6b62\u6d4b\u8bd5"
                : "\u5f00\u59cb\u6d4b\u8bd5\u6211\u7684\u97f3\u57df"}
            </button>
            <button
              type="button"
              onClick={handleSaveProfile}
              disabled={!range.lowest || !range.highest || isSavingProfile}
              className="inline-flex items-center justify-center rounded-full border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-100 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSavingProfile
                ? "\u6b63\u5728\u4fdd\u5b58..."
                : "\u4fdd\u5b58\u6211\u7684\u97f3\u57df"}
            </button>
          </div>
          <p className="text-sm text-slate-400">
            {isListening
              ? "\u6b63\u5728\u76d1\u542c\uff0c\u8bf7\u7528\u7a33\u5b9a\u957f\u97f3\u6162\u6162\u5f80\u9ad8\u97f3\u548c\u4f4e\u97f3\u5ef6\u4f38\u3002"
              : "\u5c1a\u672a\u5f00\u59cb\u3002\u5efa\u8bae\u5728\u5b89\u9759\u73af\u5883\u4e2d\u6d4b\u8bd5\u3002"}
          </p>
        </div>

        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-5">
          <p className="text-sm font-semibold text-cyan-300">
            {"\u600e\u4e48\u6d4b\u66f4\u51c6"}
          </p>
          <ul className="mt-3 grid gap-2 text-sm text-slate-300">
            {TEST_GUIDANCE_ITEMS.map((item) => (
              <li key={item} className="leading-6">
                {item}
              </li>
            ))}
          </ul>
        </div>

        {permissionError ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
            {permissionError}
          </div>
        ) : null}

        {profileError ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
            {profileError}
          </div>
        ) : null}

        {saveMessage ? (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            {saveMessage}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
              {"\u5f53\u524d\u97f3\u9ad8"}
            </p>
            <div className="mt-6 flex flex-col gap-4">
              <p className="text-6xl font-semibold tracking-tight text-emerald-400 sm:text-7xl">
                {currentPitch?.noteName ?? "--"}
              </p>
              <div className="flex flex-wrap gap-4 text-sm text-slate-300">
                <span>
                  {"\u9891\u7387"}: {formatFrequency(currentPitch?.frequency)}
                </span>
                <span>
                  {"\u504f\u5dee"}:{" "}
                  {currentPitch ? `${currentPitch.cents > 0 ? "+" : ""}${currentPitch.cents} cents` : "--"}
                </span>
              </div>
              <p className="text-sm text-slate-400">
                {currentPitch
                  ? "\u68c0\u6d4b\u5230\u6e05\u6670\u97f3\u9ad8\u3002\u7ee7\u7eed\u4fdd\u6301\u7a33\u5b9a\u53d1\u58f0\u6765\u66f4\u65b0\u97f3\u57df\u7ed3\u679c\u3002"
                  : "\u7b49\u5f85\u6e05\u6670\u7684\u4eba\u58f0\u8f93\u5165\u3002\u77ed\u4fc3\u3001\u5634\u6742\u6216\u8fc7\u8f7b\u7684\u58f0\u97f3\u4f1a\u88ab\u5ffd\u7565\u3002"}
              </p>
            </div>
          </div>

          <div className="grid gap-4">
            <ResultCard
              label={"\u6700\u4f4e\u7a33\u5b9a\u97f3"}
              note={range.lowest}
              accentClass="text-sky-300"
            />
            <ResultCard
              label={"\u6700\u9ad8\u7a33\u5b9a\u97f3"}
              note={range.highest}
              accentClass="text-fuchsia-300"
            />
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                {"\u5f53\u524d\u5df2\u4fdd\u5b58\u6863\u6848"}
              </p>
              <div className="mt-3 space-y-1">
                <p className="text-3xl font-semibold text-cyan-300">
                  {savedProfile
                    ? `${savedProfile.comfortable_low_note.note_name} - ${savedProfile.comfortable_high_note.note_name}`
                    : "--"}
                </p>
                <p className="text-sm text-slate-300">
                  {savedProfile
                    ? `ID: ${savedProfile.id.slice(0, 8)}`
                    : "\u4f60\u4fdd\u5b58\u540e\uff0c\u540e\u7eed\u4e0a\u4f20\u6b4c\u66f2\u4f1a\u76f4\u63a5\u4f7f\u7528\u8fd9\u4e2a\u6863\u6848\u3002"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
