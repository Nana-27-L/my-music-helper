import { useEffect, useMemo, useRef, useState } from "react";
import { mixRecording, processSong } from "../lib/api";

const RECORDING_COUNTDOWN_SECONDS = 3;
const MIN_RECORDING_SECONDS = 0.3;
const DEFAULT_ACCOMPANIMENT_GAIN_DB = -4;
const DEFAULT_VOCAL_GAIN_DB = 0;

function formatShift(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }

  return value > 0 ? `+${value}` : `${value}`;
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;

  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatGain(value) {
  return value > 0 ? `+${value} dB` : `${value} dB`;
}

function releaseAudioAsset(asset) {
  if (asset?.audioUrl) {
    URL.revokeObjectURL(asset.audioUrl);
  }
}

function releaseAudioAssets(assets) {
  for (const asset of assets) {
    releaseAudioAsset(asset);
  }
}

function createAudioAsset(blob, fileName, extra = {}) {
  return {
    audioUrl: URL.createObjectURL(blob),
    blob,
    fileName,
    ...extra,
  };
}

function mergeFloat32Chunks(chunks) {
  const totalLength = chunks.reduce((length, chunk) => length + chunk.length, 0);
  const merged = new Float32Array(totalLength);

  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function writeAsciiString(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function encodeMonoWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  writeAsciiString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeAsciiString(view, 8, "WAVE");
  writeAsciiString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAsciiString(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(
      offset,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true,
    );
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function createSafeStem(fileName) {
  return (fileName ?? "singmykey")
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function createTakeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `take_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function SongProcessor({ profile, profileStatus = "idle" }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [manualShift, setManualShift] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [recordingState, setRecordingState] = useState("idle");
  const [recordingCountdown, setRecordingCountdown] = useState(
    RECORDING_COUNTDOWN_SECONDS,
  );
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingError, setRecordingError] = useState("");
  const [recordedTakes, setRecordedTakes] = useState([]);
  const [selectedTakeId, setSelectedTakeId] = useState(null);
  const [accompanimentGainDb, setAccompanimentGainDb] = useState(
    DEFAULT_ACCOMPANIMENT_GAIN_DB,
  );
  const [vocalGainDb, setVocalGainDb] = useState(DEFAULT_VOCAL_GAIN_DB);
  const [mixedSong, setMixedSong] = useState(null);

  const accompanimentAudioRef = useRef(null);
  const recordingContextRef = useRef(null);
  const recordingStreamRef = useRef(null);
  const recordingSourceRef = useRef(null);
  const recordingProcessorRef = useRef(null);
  const recordingMonitorRef = useRef(null);
  const recordingSampleRateRef = useRef(44100);
  const recordingChunksRef = useRef([]);
  const isCaptureActiveRef = useRef(false);
  const isFinalizingTakeRef = useRef(false);
  const countdownTimerRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const audioEndedHandlerRef = useRef(null);
  const recordedTakesRef = useRef([]);

  useEffect(() => () => releaseAudioAsset(result), [result]);
  useEffect(() => () => releaseAudioAsset(mixedSong), [mixedSong]);

  useEffect(() => {
    recordedTakesRef.current = recordedTakes;
  }, [recordedTakes]);

  useEffect(() => {
    return () => {
      releaseAudioAssets(recordedTakesRef.current);
      void teardownCaptureSession();
    };
  }, []);

  const comfortableRangeLabel = useMemo(() => {
    if (!profile) {
      return "--";
    }

    return `${profile.comfortable_low_note.note_name} - ${profile.comfortable_high_note.note_name}`;
  }, [profile]);

  const selectedTake = useMemo(() => {
    if (!recordedTakes.length) {
      return null;
    }

    return (
      recordedTakes.find((take) => take.id === selectedTakeId) ??
      recordedTakes[recordedTakes.length - 1]
    );
  }, [recordedTakes, selectedTakeId]);

  const recordedTakeCount = recordedTakes.length;
  const isPreparingRecording = recordingState === "countdown";
  const isRecording = recordingState === "recording";
  const isMixingSong = recordingState === "mixing";
  const isProfileLoading = profileStatus === "loading";
  const needsProfile = !profile && !isProfileLoading;
  const submitButtonLabel = isProcessing
    ? "\u6b63\u5728\u751f\u6210\u4f34\u594f..."
    : isProfileLoading
      ? "\u6b63\u5728\u8bfb\u53d6\u97f3\u57df\u6863\u6848..."
      : !profile
        ? "\u5148\u4fdd\u5b58\u97f3\u57df\u540e\u518d\u751f\u6210"
        : !selectedFile
          ? "\u5148\u9009\u62e9\u6b4c\u66f2\u518d\u751f\u6210"
          : "\u751f\u6210\u9002\u5408\u6211\u5531\u7684\u7248\u672c";
  const submitHint = isProfileLoading
    ? "\u6b63\u5728\u8bfb\u53d6\u4f60\u4e4b\u524d\u4fdd\u5b58\u7684\u97f3\u57df\u6863\u6848\uff0c\u8bfb\u53d6\u6210\u529f\u540e\u8fd9\u91cc\u4f1a\u81ea\u52a8\u89e3\u9501\u3002"
    : needsProfile
      ? "\u8bf7\u5148\u5728\u4e0a\u65b9\u70b9\u201c\u5f00\u59cb\u6d4b\u8bd5\u6211\u7684\u97f3\u57df\u201d\uff0c\u6d4b\u5b8c\u540e\u518d\u70b9\u201c\u4fdd\u5b58\u6211\u7684\u97f3\u57df\u201d\uff0c\u4fdd\u5b58\u6210\u529f\u540e\u8fd9\u91cc\u4f1a\u81ea\u52a8\u89e3\u9501\u3002"
      : !selectedFile
        ? "\u73b0\u5728\u53ea\u5dee\u4e00\u6b65\uff1a\u9009\u4e00\u9996\u6b4c\u66f2\uff0c\u7136\u540e\u5c31\u53ef\u4ee5\u751f\u6210\u9002\u5408\u4f60\u5531\u7684\u4f34\u594f\u4e86\u3002"
        : "\u9ed8\u8ba4\u4f1a\u81ea\u52a8\u8ba1\u7b97\u5efa\u8bae\u8f6c\u8c03\uff0c\u4f60\u4e5f\u53ef\u4ee5\u624b\u52a8\u6307\u5b9a\u3002\u5982\u679c\u5f53\u524d\u73af\u5883\u8fd8\u6ca1\u6709\u53ef\u7528\u7684\u4eba\u58f0\u5206\u79bb\u5f15\u64ce\uff0c\u624b\u52a8\u534a\u97f3\u4ecd\u7136\u53ef\u4ee5\u76f4\u63a5\u5904\u7406\u6574\u9996\u6b4c\u3002";

  function clearCountdownTimer() {
    if (countdownTimerRef.current) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }

  function clearRecordingTimer() {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  function resetAccompanimentPlayback() {
    const audio = accompanimentAudioRef.current;

    if (!audio) {
      return;
    }

    if (audioEndedHandlerRef.current) {
      audio.removeEventListener("ended", audioEndedHandlerRef.current);
      audioEndedHandlerRef.current = null;
    }

    audio.pause();
    audio.currentTime = 0;
  }

  function clearMixedSong() {
    releaseAudioAsset(mixedSong);
    setMixedSong(null);
  }

  function resetRecordedTakes() {
    releaseAudioAssets(recordedTakesRef.current);
    recordedTakesRef.current = [];
    setRecordedTakes([]);
    setSelectedTakeId(null);
  }

  async function teardownCaptureSession() {
    clearCountdownTimer();
    clearRecordingTimer();
    resetAccompanimentPlayback();

    isCaptureActiveRef.current = false;

    if (recordingSourceRef.current) {
      recordingSourceRef.current.disconnect();
      recordingSourceRef.current = null;
    }

    if (recordingProcessorRef.current) {
      recordingProcessorRef.current.onaudioprocess = null;
      recordingProcessorRef.current.disconnect();
      recordingProcessorRef.current = null;
    }

    if (recordingMonitorRef.current) {
      recordingMonitorRef.current.disconnect();
      recordingMonitorRef.current = null;
    }

    if (recordingStreamRef.current) {
      recordingStreamRef.current.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
    }

    if (recordingContextRef.current) {
      await recordingContextRef.current.close();
      recordingContextRef.current = null;
    }
  }

  async function prepareCaptureSession() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("\u5f53\u524d\u6d4f\u89c8\u5668\u4e0d\u652f\u6301\u9ea6\u514b\u98ce\u5f55\u97f3\u3002");
    }

    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;

    if (!AudioContextClass) {
      throw new Error("\u5f53\u524d\u6d4f\u89c8\u5668\u4e0d\u652f\u6301\u97f3\u9891\u5f55\u5236\u4e0a\u4e0b\u6587\u3002");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
      },
    });

    const audioContext = new AudioContextClass();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const silentMonitor = audioContext.createGain();

    silentMonitor.gain.value = 0;

    processor.onaudioprocess = (event) => {
      if (!isCaptureActiveRef.current) {
        return;
      }

      const input = event.inputBuffer.getChannelData(0);
      recordingChunksRef.current.push(new Float32Array(input));
    };

    source.connect(processor);
    processor.connect(silentMonitor);
    silentMonitor.connect(audioContext.destination);

    await audioContext.resume();

    recordingContextRef.current = audioContext;
    recordingStreamRef.current = stream;
    recordingSourceRef.current = source;
    recordingProcessorRef.current = processor;
    recordingMonitorRef.current = silentMonitor;
    recordingSampleRateRef.current = audioContext.sampleRate;
  }

  async function finalizeTake({ keepTake }) {
    if (isFinalizingTakeRef.current) {
      return;
    }

    isFinalizingTakeRef.current = true;

    try {
      clearCountdownTimer();
      clearRecordingTimer();
      resetAccompanimentPlayback();

      isCaptureActiveRef.current = false;

      const samples = mergeFloat32Chunks(recordingChunksRef.current);
      const sampleRate = recordingSampleRateRef.current;

      recordingChunksRef.current = [];
      setRecordingDuration(0);

      await teardownCaptureSession();

      if (!keepTake) {
        setRecordingState("idle");
        return;
      }

      if (samples.length < sampleRate * MIN_RECORDING_SECONDS) {
        setRecordingState("idle");
        setRecordingError("\u5f55\u5236\u65f6\u95f4\u592a\u77ed\u4e86\uff0c\u8bf7\u91cd\u65b0\u8bd5\u4e00\u6b21\u3002");
        return;
      }

      const takeNumber = recordedTakesRef.current.length + 1;
      const baseFileName = createSafeStem(result?.fileName ?? "singmykey_take");
      const nextTake = createAudioAsset(
        encodeMonoWav(samples, sampleRate),
        `${baseFileName}_vocal_take_${String(takeNumber).padStart(2, "0")}.wav`,
        {
          durationSeconds: samples.length / sampleRate,
          id: createTakeId(),
          label: `Take ${String(takeNumber).padStart(2, "0")}`,
        },
      );

      clearMixedSong();
      setRecordedTakes((previousTakes) => {
        const nextTakes = [...previousTakes, nextTake];
        recordedTakesRef.current = nextTakes;
        return nextTakes;
      });
      setSelectedTakeId(nextTake.id);
      setRecordingState("ready");
    } finally {
      isFinalizingTakeRef.current = false;
    }
  }

  async function startCaptureAndPlayback() {
    const audio = accompanimentAudioRef.current;

    if (!audio) {
      await teardownCaptureSession();
      setRecordingState("idle");
      throw new Error("\u5904\u7406\u540e\u7684\u4f34\u594f\u8fd8\u6ca1\u6709\u51c6\u5907\u597d\u3002");
    }

    recordingChunksRef.current = [];
    isCaptureActiveRef.current = true;
    setRecordingState("recording");
    setRecordingDuration(0);

    const startedAt = performance.now();
    recordingTimerRef.current = window.setInterval(() => {
      setRecordingDuration((performance.now() - startedAt) / 1000);
    }, 200);

    audioEndedHandlerRef.current = () => {
      void finalizeTake({ keepTake: true });
    };
    audio.addEventListener("ended", audioEndedHandlerRef.current, { once: true });

    audio.currentTime = 0;
    await audio.play();
  }

  async function handleStartRecording() {
    if (!result) {
      setRecordingError("\u8bf7\u5148\u751f\u6210\u4e00\u7248\u9002\u5408\u4f60\u7684\u4f34\u594f\u3002");
      return;
    }

    setRecordingError("");
    setRecordingCountdown(RECORDING_COUNTDOWN_SECONDS);
    setRecordingDuration(0);
    clearMixedSong();

    try {
      await teardownCaptureSession();
      await prepareCaptureSession();
    } catch (requestError) {
      setRecordingState("idle");
      setRecordingError(requestError.message);
      await teardownCaptureSession();
      return;
    }

    setRecordingState("countdown");

    countdownTimerRef.current = window.setInterval(() => {
      setRecordingCountdown((previousCountdown) => {
        if (previousCountdown <= 1) {
          clearCountdownTimer();

          window.setTimeout(() => {
            void startCaptureAndPlayback().catch(async (requestError) => {
              setRecordingState("idle");
              setRecordingError(requestError.message);
              await teardownCaptureSession();
            });
          }, 0);

          return 0;
        }

        return previousCountdown - 1;
      });
    }, 1000);
  }

  async function handleStopRecording() {
    if (isPreparingRecording) {
      await teardownCaptureSession();
      setRecordingState("idle");
      setRecordingDuration(0);
      return;
    }

    if (isRecording) {
      await finalizeTake({ keepTake: true });
    }
  }

  function handleSelectTake(takeId) {
    if (takeId === selectedTakeId) {
      return;
    }

    clearMixedSong();
    setSelectedTakeId(takeId);
    setRecordingState("ready");
  }

  function handleAccompanimentGainChange(nextValue) {
    clearMixedSong();
    setAccompanimentGainDb(nextValue);
  }

  function handleVocalGainChange(nextValue) {
    clearMixedSong();
    setVocalGainDb(nextValue);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!profile) {
      setError("\u8bf7\u5148\u4fdd\u5b58\u4f60\u7684\u97f3\u57df\u6863\u6848\u3002");
      return;
    }

    if (!selectedFile) {
      setError("\u8bf7\u5148\u9009\u62e9\u4e00\u9996 MP3 \u6b4c\u66f2\u3002");
      return;
    }

    setIsProcessing(true);
    setError("");
    setRecordingError("");

    try {
      const response = await processSong({
        audioFile: selectedFile,
        profileId: profile.id,
        semitones: manualShift === "" ? undefined : Number(manualShift),
      });

      releaseAudioAsset(result);
      resetRecordedTakes();
      clearMixedSong();
      setRecordingState("idle");
      setRecordingDuration(0);
      setAccompanimentGainDb(DEFAULT_ACCOMPANIMENT_GAIN_DB);
      setVocalGainDb(DEFAULT_VOCAL_GAIN_DB);
      await teardownCaptureSession();

      setResult({
        ...createAudioAsset(response.blob, response.fileName),
        metadata: response.metadata,
      });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleExportMixedSong() {
    if (!result || !selectedTake) {
      setRecordingError("\u8bf7\u5148\u5f55\u4e00\u904d\u4f60\u7684\u4eba\u58f0\uff0c\u518d\u9009\u62e9\u8981\u5bfc\u51fa\u7684\u7248\u672c\u3002");
      return;
    }

    setRecordingError("");
    setRecordingState("mixing");

    try {
      const response = await mixRecording({
        accompanimentBlob: result.blob,
        accompanimentFileName: result.fileName,
        accompanimentGainDb,
        vocalBlob: selectedTake.blob,
        vocalFileName: selectedTake.fileName,
        vocalGainDb,
      });

      releaseAudioAsset(mixedSong);
      setMixedSong(createAudioAsset(response.blob, response.fileName));
      setRecordingState("ready");
    } catch (requestError) {
      setRecordingState("ready");
      setRecordingError(requestError.message);
    }
  }

  return (
    <section className="rounded-[2rem] border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/40 sm:p-8">
      <div className="flex flex-col gap-6">
        <div className="space-y-3">
          <p className="text-sm uppercase tracking-[0.35em] text-fuchsia-300">
            Song Processing
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">
            {"\u4e0a\u4f20\u4f60\u559c\u6b22\u7684\u6b4c\uff0c\u8f93\u51fa\u66f4\u9002\u5408\u4f60\u5531\u7684\u4f34\u594f"}
          </h2>
          <p className="max-w-3xl text-base text-slate-300">
            {"\u540e\u7aef\u4f1a\u5148\u53c2\u8003\u4f60\u4fdd\u5b58\u7684\u8212\u9002\u97f3\u57df\uff0c\u518d\u5206\u79bb\u6b4c\u66f2\u7684\u4eba\u58f0\u548c\u4f34\u594f\uff0c\u5e76\u81ea\u52a8\u7ed9\u51fa\u9002\u5408\u7684\u5347\u964d\u8c03\u3002"}
          </p>
        </div>

        <div className="grid gap-4 rounded-3xl border border-slate-800 bg-slate-950/70 p-5 md:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
              {"\u5df2\u4fdd\u5b58\u6863\u6848"}
            </p>
            <p className="mt-3 text-xl font-semibold text-slate-100">
              {isProfileLoading
                ? "\u8bfb\u53d6\u4e2d"
                : profile
                  ? "\u5df2\u5c31\u7eea"
                  : "\u672a\u4fdd\u5b58"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
              {"\u8212\u9002\u97f3\u57df"}
            </p>
            <p className="mt-3 text-xl font-semibold text-cyan-300">
              {comfortableRangeLabel}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
              {"\u6781\u9650\u97f3\u57df"}
            </p>
            <p className="mt-3 text-xl font-semibold text-slate-100">
              {profile
                ? `${profile.lowest_note.note_name} - ${profile.highest_note.note_name}`
                : "--"}
            </p>
          </div>
        </div>

        {needsProfile ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
            {"\u8fd9\u4e00\u533a\u57df\u73b0\u5728\u8fd8\u6ca1\u89e3\u9501\u3002\u8bf7\u5148\u5728\u4e0a\u65b9\u5b8c\u6210\u4e00\u6b21\u97f3\u57df\u6d4b\u8bd5\uff0c\u7136\u540e\u70b9\u201c\u4fdd\u5b58\u6211\u7684\u97f3\u57df\u201d\u3002"}
          </div>
        ) : null}

        {isProfileLoading ? (
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4 text-sm text-cyan-100">
            {"\u6b63\u5728\u8bfb\u53d6\u4f60\u4e4b\u524d\u4fdd\u5b58\u7684\u97f3\u57df\u6863\u6848\uff0c\u8bfb\u53d6\u5b8c\u6210\u540e\u8fd9\u91cc\u4f1a\u81ea\u52a8\u663e\u793a\u53ef\u7528\u97f3\u57df\u3002"}
          </div>
        ) : null}

        <form className="grid gap-5" onSubmit={handleSubmit}>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-slate-200">
              {"\u9009\u62e9\u6b4c\u66f2 MP3"}
            </span>
            <input
              accept=".mp3,audio/mpeg"
              className="rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-200 file:mr-4 file:rounded-full file:border-0 file:bg-cyan-400 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-950"
              onChange={(event) => {
                setSelectedFile(event.target.files?.[0] ?? null);
                setError("");
              }}
              type="file"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium text-slate-200">
              {"\u534a\u97f3\u624b\u52a8\u8986\u76d6\uff08\u53ef\u9009\uff09"}
            </span>
            <input
              className="rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-200 outline-none transition focus:border-cyan-400"
              max="24"
              min="-24"
              onChange={(event) => setManualShift(event.target.value)}
              placeholder={"\u7559\u7a7a\u5219\u81ea\u52a8\u63a8\u8350"}
              step="1"
              type="number"
              value={manualShift}
            />
          </label>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              className="inline-flex items-center justify-center rounded-full bg-fuchsia-300 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-fuchsia-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!profile || !selectedFile || isProcessing || isProfileLoading}
              type="submit"
            >
              {submitButtonLabel}
            </button>
            <p className="text-sm text-slate-400">
              {submitHint}
            </p>
          </div>
        </form>

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        {!result ? (
          <section className="rounded-3xl border border-dashed border-cyan-400/20 bg-cyan-400/5 p-6">
            <div className="space-y-3">
              <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">
                Sing Along Export
              </p>
              <h3 className="text-2xl font-semibold tracking-tight text-slate-50">
                {isProfileLoading
                  ? "\u6b63\u5728\u51c6\u5907\u4f60\u7684\u97f3\u57df\u6863\u6848"
                  : needsProfile
                    ? "\u4f60\u73b0\u5728\u5148\u9700\u8981\u5b8c\u6210\u97f3\u57df\u4fdd\u5b58"
                    : "\u8ddf\u5531\u5bfc\u51fa\u4f1a\u5728\u8fd9\u91cc\u51fa\u73b0"}
              </h3>
              <p className="max-w-3xl text-sm text-slate-300">
                {isProfileLoading
                  ? "\u7cfb\u7edf\u6b63\u5728\u8bfb\u53d6\u4f60\u4e4b\u524d\u4fdd\u5b58\u7684\u97f3\u57df\u6863\u6848\uff0c\u8bfb\u53d6\u5b8c\u6210\u540e\uff0c\u4f60\u5c31\u53ef\u4ee5\u76f4\u63a5\u4e0a\u4f20\u6b4c\u66f2\u751f\u6210\u4f34\u594f\u3002"
                  : needsProfile
                    ? "\u4f60\u73b0\u5728\u5361\u5728\u7b2c 1 \u6b65\uff1a\u5148\u5728\u4e0a\u9762\u5b8c\u6210\u97f3\u57df\u6d4b\u8bd5\u5e76\u70b9\u201c\u4fdd\u5b58\u6211\u7684\u97f3\u57df\u201d\uff0c\u4fdd\u5b58\u6210\u529f\u540e\uff0c\u4e0b\u9762\u7684\u751f\u6210\u4f34\u594f\u548c\u8ddf\u5531\u5bfc\u51fa\u90fd\u4f1a\u81ea\u52a8\u89e3\u9501\u3002"
                    : "\u4f60\u5df2\u7ecf\u5b8c\u6210\u7b2c 1 \u6b65\u4e86\uff0c\u5148\u751f\u6210\u4e00\u7248\u9002\u5408\u4f60\u7684\u4f34\u594f\uff0c\u4e0b\u9762\u5c31\u4f1a\u51fa\u73b0\u201c\u8ddf\u7740\u65b0\u4f34\u594f\u76f4\u63a5\u5531\uff0c\u5bfc\u51fa\u6210\u54c1\u201d\u7684\u533a\u57df\u3002"}
              </p>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div
                className={`rounded-2xl border p-4 ${
                  needsProfile
                    ? "border-amber-400/40 bg-amber-500/10"
                    : "border-slate-800 bg-slate-900/80"
                }`}
              >
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  {"\u7b2c 1 \u6b65"}
                </p>
                <p className="mt-3 text-lg font-semibold text-slate-100">
                  {"\u4fdd\u5b58\u4f60\u7684\u97f3\u57df"}
                </p>
                <p className={`mt-2 text-sm ${needsProfile ? "text-amber-100" : "text-slate-400"}`}>
                  {needsProfile
                    ? "\u4f60\u73b0\u5728\u5c31\u5361\u5728\u8fd9\u4e00\u6b65\uff0c\u5148\u5728\u4e0a\u9762\u6d4b\u51fa\u5e76\u4fdd\u5b58\u97f3\u57df\u6863\u6848\u3002"
                    : "\u5148\u5728\u4e0a\u9762\u6d4b\u51fa\u5e76\u4fdd\u5b58\u97f3\u57df\u6863\u6848\u3002"}
                </p>
              </div>

              <div
                className={`rounded-2xl border p-4 ${
                  !needsProfile && !isProfileLoading
                    ? "border-cyan-400/30 bg-cyan-400/10"
                    : "border-slate-800 bg-slate-900/80"
                }`}
              >
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  {"\u7b2c 2 \u6b65"}
                </p>
                <p className="mt-3 text-lg font-semibold text-slate-100">
                  {"\u751f\u6210\u65b0\u4f34\u594f"}
                </p>
                <p
                  className={`mt-2 text-sm ${
                    !needsProfile && !isProfileLoading ? "text-cyan-100" : "text-slate-400"
                  }`}
                >
                  {!needsProfile && !isProfileLoading
                    ? "\u4f60\u73b0\u5728\u53ef\u4ee5\u505a\u8fd9\u4e00\u6b65\uff1a\u4e0a\u4f20\u6b4c\u66f2\uff0c\u70b9\u201c\u751f\u6210\u9002\u5408\u6211\u5531\u7684\u7248\u672c\u201d\u3002"
                    : "\u4e0a\u4f20\u6b4c\u66f2\uff0c\u70b9\u201c\u751f\u6210\u9002\u5408\u6211\u5531\u7684\u7248\u672c\u201d\u3002"}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  {"\u7b2c 3 \u6b65"}
                </p>
                <p className="mt-3 text-lg font-semibold text-slate-100">
                  {"\u8ddf\u5531\u5e76\u5bfc\u51fa"}
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  {"\u5904\u7406\u6210\u529f\u540e\uff0c\u8fd9\u91cc\u4f1a\u663e\u793a\u8ddf\u5531\u5f55\u97f3\u3001\u6311\u9009 take \u548c\u5408\u6210\u6210\u54c1\u3002"}
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {result ? (
          <div className="grid gap-4 rounded-3xl border border-slate-800 bg-slate-950/70 p-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                {"\u5904\u7406\u7ed3\u679c"}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                    {"\u5e94\u7528\u8f6c\u8c03"}
                  </p>
                  <p className="mt-3 text-3xl font-semibold text-emerald-400">
                    {formatShift(result.metadata.appliedShift)}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                    {"\u7cfb\u7edf\u63a8\u8350"}
                  </p>
                  <p className="mt-3 text-3xl font-semibold text-cyan-300">
                    {formatShift(result.metadata.recommendedShift)}
                  </p>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-sm text-slate-300">
                <p>
                  {"\u6b4c\u66f2\u4f30\u8ba1\u97f3\u57df"}: {result.metadata.songLowNote ?? "--"} -{" "}
                  {result.metadata.songHighNote ?? "--"}
                </p>
                <p className="mt-2">
                  {"\u4f60\u7684\u8212\u9002\u97f3\u57df"}: {result.metadata.comfortLowNote ?? "--"} -{" "}
                  {result.metadata.comfortHighNote ?? "--"}
                </p>
                {result.metadata.processingMode === "direct-full-mix" ? (
                  <p className="mt-3 text-amber-200">
                    {"\u672c\u6b21\u56e0\u4e3a\u73af\u5883\u4e2d\u6682\u65f6\u4e0d\u53ef\u7528\u4eba\u58f0\u5206\u79bb\uff0c\u7cfb\u7edf\u76f4\u63a5\u5bf9\u6574\u9996\u6b4c\u505a\u4e86\u624b\u52a8\u8f6c\u8c03\uff0c\u6ca1\u6709\u751f\u6210\u81ea\u52a8\u97f3\u57df\u5206\u6790\u3002"}
                  </p>
                ) : (
                  <p className="mt-3 text-emerald-200">
                    {"\u7cfb\u7edf\u5df2\u6839\u636e\u4f60\u7684\u97f3\u57df\u81ea\u52a8\u8ba1\u7b97\u51fa\u5f53\u524d\u66f2\u76ee\u66f4\u8212\u9002\u7684\u8c03\u6027\u3002"}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <audio
                ref={accompanimentAudioRef}
                className="w-full"
                controls
                src={result.audioUrl}
              />
              <a
                className="inline-flex items-center justify-center rounded-full border border-slate-600 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:border-slate-400 hover:text-white"
                download={result.fileName}
                href={result.audioUrl}
              >
                {"\u4e0b\u8f7d\u5904\u7406\u540e\u7684\u4f34\u594f"}
              </a>
            </div>
          </div>
        ) : null}

        {result ? (
          <section className="rounded-3xl border border-slate-800 bg-slate-950/70 p-6">
            <div className="space-y-3">
              <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">
                Sing Along Export
              </p>
              <h3 className="text-2xl font-semibold tracking-tight text-slate-50">
                {"\u8ddf\u7740\u65b0\u4f34\u594f\u76f4\u63a5\u5531\uff0c\u5bfc\u51fa\u6210\u54c1"}
              </h3>
              <p className="max-w-3xl text-sm text-slate-300">
                {"\u5efa\u8bae\u6234\u8033\u673a\u5f55\u97f3\uff0c\u8fd9\u6837\u4f34\u594f\u4e0d\u4f1a\u4e32\u8fdb\u9ea6\u514b\u98ce\u3002\u4f60\u53ef\u4ee5\u591a\u5f55\u51e0\u904d\uff0c\u4fdd\u7559\u6240\u6709 take\uff0c\u6700\u540e\u6311\u4e00\u904d\u6700\u6ee1\u610f\u7684\u7248\u672c\u518d\u5bfc\u51fa\u3002"}
              </p>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  {"\u5f53\u524d\u72b6\u6001"}
                </p>
                <p className="mt-3 text-xl font-semibold text-slate-100">
                  {isPreparingRecording
                    ? "\u5012\u8ba1\u65f6\u4e2d"
                    : isRecording
                      ? "\u6b63\u5728\u8ddf\u5531"
                      : isMixingSong
                        ? "\u6b63\u5728\u5408\u6210"
                        : recordedTakeCount
                          ? "\u53ef\u4ee5\u6311\u9009 take"
                          : "\u5c1a\u672a\u5f00\u59cb"}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  {"\u5df2\u5b8c\u6210 take"}
                </p>
                <p className="mt-3 text-xl font-semibold text-cyan-300">
                  {recordedTakeCount ? recordedTakeCount : "--"}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  {"\u9009\u4e2d\u5bfc\u51fa"}
                </p>
                <p className="mt-3 text-xl font-semibold text-slate-100">
                  {selectedTake ? selectedTake.label : "--"}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  {"\u5f55\u5236\u65f6\u957f"}
                </p>
                <p className="mt-3 text-xl font-semibold text-slate-100">
                  {isRecording
                    ? formatDuration(recordingDuration)
                    : selectedTake
                      ? formatDuration(selectedTake.durationSeconds ?? 0)
                      : "--"}
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <button
                className="inline-flex items-center justify-center rounded-full bg-cyan-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isProcessing || isPreparingRecording || isRecording || isMixingSong}
                onClick={() => {
                  void handleStartRecording();
                }}
                type="button"
              >
                {recordedTakeCount
                  ? "\u4fdd\u7559\u5df2\u6709\u7248\u672c\uff0c\u518d\u5f55\u4e00\u904d"
                  : "\u0033 \u79d2\u540e\u5f00\u59cb\u8ddf\u5531"}
              </button>

              {isPreparingRecording || isRecording ? (
                <button
                  className="inline-flex items-center justify-center rounded-full border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-100 transition hover:border-slate-400"
                  onClick={() => {
                    void handleStopRecording();
                  }}
                  type="button"
                >
                  {isPreparingRecording
                    ? "\u53d6\u6d88\u5012\u8ba1\u65f6"
                    : "\u7ed3\u675f\u672c\u6b21\u5f55\u5236"}
                </button>
              ) : null}

              <button
                className="inline-flex items-center justify-center rounded-full bg-emerald-300 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!selectedTake || isMixingSong || isPreparingRecording || isRecording}
                onClick={() => {
                  void handleExportMixedSong();
                }}
                type="button"
              >
                {isMixingSong
                  ? "\u6b63\u5728\u5408\u6210\u6210\u54c1..."
                  : "\u5bfc\u51fa\u9009\u4e2d take \u7684\u6210\u54c1"}
              </button>
            </div>

            {recordingError ? (
              <div className="mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
                {recordingError}
              </div>
            ) : null}

            {isPreparingRecording ? (
              <div className="mt-5 rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4 text-sm text-cyan-100">
                {"\u8bf7\u6234\u597d\u8033\u673a\u51c6\u5907\u5f00\u5531\uff0c\u4f34\u594f\u4f1a\u5728\u5012\u8ba1\u65f6\u7ed3\u675f\u540e\u81ea\u52a8\u64ad\u653e\u3002"}
              </div>
            ) : null}

            <div className="mt-5 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  {"\u6df7\u97f3\u5fae\u8c03"}
                </p>
                <div className="mt-4 space-y-5">
                  <label className="grid gap-2">
                    <span className="flex items-center justify-between text-sm text-slate-200">
                      <span>{"\u4f34\u594f\u97f3\u91cf"}</span>
                      <span className="font-medium text-cyan-300">
                        {formatGain(accompanimentGainDb)}
                      </span>
                    </span>
                    <input
                      className="accent-cyan-300"
                      max="3"
                      min="-12"
                      onChange={(event) => {
                        handleAccompanimentGainChange(Number(event.target.value));
                      }}
                      step="1"
                      type="range"
                      value={accompanimentGainDb}
                    />
                    <p className="text-xs text-slate-400">
                      {"\u5982\u679c\u4eba\u58f0\u4e0d\u591f\u7a81\u51fa\uff0c\u53ef\u4ee5\u518d\u628a\u4f34\u594f\u964d\u4e00\u70b9\u3002"}
                    </p>
                  </label>

                  <label className="grid gap-2">
                    <span className="flex items-center justify-between text-sm text-slate-200">
                      <span>{"\u4eba\u58f0\u97f3\u91cf"}</span>
                      <span className="font-medium text-emerald-300">
                        {formatGain(vocalGainDb)}
                      </span>
                    </span>
                    <input
                      className="accent-emerald-300"
                      max="6"
                      min="-6"
                      onChange={(event) => {
                        handleVocalGainChange(Number(event.target.value));
                      }}
                      step="1"
                      type="range"
                      value={vocalGainDb}
                    />
                    <p className="text-xs text-slate-400">
                      {"\u5982\u679c\u4f60\u5531\u5f97\u6bd4\u8f83\u8f7b\uff0c\u53ef\u4ee5\u7ed9\u4eba\u58f0\u52a0 1 \u5230 3 dB \u8bd5\u8bd5\u3002"}
                    </p>
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  {"\u5bfc\u51fa\u63d0\u793a"}
                </p>
                <div className="mt-4 space-y-3 text-sm text-slate-300">
                  <p>
                    {"\u4f60\u53ef\u4ee5\u5148\u5f55\u51e0\u904d\uff0c\u542c\u5b8c\u540e\u518d\u6311\u9009\u6700\u6ee1\u610f\u7684 take \u4f5c\u4e3a\u5bfc\u51fa\u7248\u672c\u3002"}
                  </p>
                  <p>
                    {"\u53ea\u8981\u4f60\u5207\u6362 take \u6216\u8005\u62d6\u52a8\u4e0a\u9762\u7684\u6df7\u97f3\u6ed1\u6746\uff0c\u5c31\u9700\u8981\u91cd\u65b0\u70b9\u4e00\u6b21\u5bfc\u51fa\u3002"}
                  </p>
                  <p className="text-cyan-100">
                    {selectedTake
                      ? `\u5f53\u524d\u9009\u4e2d ${selectedTake.label}\uff0c\u5c06\u6309 ${formatGain(
                          accompanimentGainDb,
                        )} \u4f34\u594f / ${formatGain(vocalGainDb)} \u4eba\u58f0\u8fdb\u884c\u5408\u6210\u3002`
                      : "\u8fd8\u6ca1\u6709 take\uff0c\u53ef\u4ee5\u5148\u5f55\u4e00\u904d\u518d\u8fdb\u884c\u5bfc\u51fa\u3002"}
                  </p>
                </div>
              </div>
            </div>

            {recordedTakeCount ? (
              <div className="mt-5 space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                      {"\u4fdd\u7559\u7684 take"}
                    </p>
                    <p className="mt-2 text-sm text-slate-300">
                      {"\u6240\u6709\u5f55\u97f3\u90fd\u4f1a\u4fdd\u7559\u5728\u8fd9\u91cc\uff0c\u70b9\u51fb\u6309\u94ae\u5373\u53ef\u6307\u5b9a\u5bfc\u51fa\u7248\u672c\u3002"}
                    </p>
                  </div>
                  <p className="text-sm text-slate-400">
                    {`\u5df2\u5f55\u5236 ${recordedTakeCount} \u904d`}
                  </p>
                </div>

                <div className="grid gap-4">
                  {recordedTakes.map((take) => {
                    const isSelected = selectedTake?.id === take.id;

                    return (
                      <div
                        className={`rounded-2xl border p-4 transition ${
                          isSelected
                            ? "border-cyan-300/60 bg-cyan-400/10"
                            : "border-slate-800 bg-slate-900/80"
                        }`}
                        key={take.id}
                      >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-3">
                              <p className="text-lg font-semibold text-slate-100">
                                {take.label}
                              </p>
                              <span
                                className={`rounded-full px-3 py-1 text-xs font-medium ${
                                  isSelected
                                    ? "bg-cyan-300 text-slate-950"
                                    : "bg-slate-800 text-slate-300"
                                }`}
                              >
                                {isSelected
                                  ? "\u5f53\u524d\u7528\u4e8e\u5bfc\u51fa"
                                  : "\u53ef\u5207\u6362"}
                              </span>
                            </div>
                            <p className="text-sm text-slate-400">
                              {`\u65f6\u957f ${formatDuration(take.durationSeconds ?? 0)}`}
                            </p>
                          </div>

                          <div className="flex flex-col gap-3 sm:flex-row">
                            <button
                              className={`inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold transition ${
                                isSelected
                                  ? "border border-cyan-300/40 bg-cyan-300/15 text-cyan-100"
                                  : "bg-slate-100 text-slate-950 hover:bg-white"
                              }`}
                              disabled={isSelected}
                              onClick={() => {
                                handleSelectTake(take.id);
                              }}
                              type="button"
                            >
                              {isSelected
                                ? "\u5df2\u9009\u4e2d"
                                : "\u8bbe\u4e3a\u5bfc\u51fa\u7248\u672c"}
                            </button>

                            <a
                              className="inline-flex items-center justify-center rounded-full border border-slate-600 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:border-slate-400 hover:text-white"
                              download={take.fileName}
                              href={take.audioUrl}
                            >
                              {"\u4e0b\u8f7d\u8fd9\u904d\u4eba\u58f0"}
                            </a>
                          </div>
                        </div>

                        <audio className="mt-4 w-full" controls src={take.audioUrl} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-5 text-sm text-slate-400">
                {"\u8fd8\u6ca1\u6709\u5f55\u97f3 take\u3002\u5148\u70b9\u4e0a\u9762\u7684\u6309\u94ae\u5f00\u59cb\uff0c\u7cfb\u7edf\u4f1a\u5728 3 \u79d2\u540e\u64ad\u653e\u4f34\u594f\u5e76\u540c\u6b65\u5f55\u4e0b\u4f60\u7684\u6f14\u5531\u3002"}
              </div>
            )}

            {mixedSong ? (
              <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  {"\u5408\u6210\u6210\u54c1"}
                </p>
                <p className="mt-3 text-sm text-slate-300">
                  {selectedTake
                    ? `\u5df2\u4f7f\u7528 ${selectedTake.label} \u5b8c\u6210\u672c\u6b21\u5408\u6210\u3002`
                    : "\u5df2\u751f\u6210\u5408\u6210\u6210\u54c1\u3002"}
                </p>
                <audio className="mt-4 w-full" controls src={mixedSong.audioUrl} />
                <a
                  className="mt-4 inline-flex items-center justify-center rounded-full border border-slate-600 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:border-slate-400 hover:text-white"
                  download={mixedSong.fileName}
                  href={mixedSong.audioUrl}
                >
                  {"\u4e0b\u8f7d\u6210\u54c1"}
                </a>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </section>
  );
}
