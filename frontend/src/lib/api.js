function resolveApiBaseUrl() {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }

  if (typeof window === "undefined") {
    return "http://localhost:8000";
  }

  const { hostname, origin } = window.location;
  const currentPort = window.location.port;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:8000";
  }

  if (currentPort === "3000" || currentPort === "5173") {
    return `${window.location.protocol}//${hostname}:8000`;
  }

  return origin;
}

const API_BASE_URL = resolveApiBaseUrl();

async function parseErrorMessage(response, fallbackMessage) {
  try {
    const data = await response.json();

    if (typeof data?.detail === "string") {
      return data.detail;
    }
  } catch (error) {
    return fallbackMessage;
  }

  return fallbackMessage;
}

export async function fetchHealth() {
  const response = await fetch(`${API_BASE_URL}/api/health`);

  if (!response.ok) {
    throw new Error("Failed to fetch backend health status.");
  }

  return response.json();
}

export async function saveVocalProfile(range) {
  const response = await fetch(`${API_BASE_URL}/api/vocal-profile`, {
    body: JSON.stringify({
      highest_note: range.highest,
      lowest_note: range.lowest,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Failed to save vocal profile."));
  }

  return response.json();
}

export async function fetchVocalProfile(profileId) {
  const response = await fetch(`${API_BASE_URL}/api/vocal-profile/${profileId}`);

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Failed to load vocal profile."));
  }

  return response.json();
}

function getHeaderNumber(headers, key) {
  const value = headers.get(key);

  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function processSong({ audioFile, profileId, semitones }) {
  const formData = new FormData();

  formData.append("audio_file", audioFile);
  formData.append("profile_id", profileId);

  if (semitones !== "" && semitones !== null && semitones !== undefined) {
    formData.append("semitones", String(semitones));
  }

  const response = await fetch(`${API_BASE_URL}/api/process-song`, {
    body: formData,
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Failed to process song."));
  }

  const blob = await response.blob();

  return {
    blob,
    fileName:
      response.headers.get("Content-Disposition")?.match(/filename="?([^"]+)"?/)?.[1] ??
      "singmykey_processed.wav",
    metadata: {
      appliedShift: getHeaderNumber(response.headers, "X-SingMyKey-Applied-Shift"),
      recommendedShift: getHeaderNumber(response.headers, "X-SingMyKey-Recommended-Shift"),
      songHighNote: response.headers.get("X-SingMyKey-Song-High-Note"),
      songLowNote: response.headers.get("X-SingMyKey-Song-Low-Note"),
      comfortHighNote: response.headers.get("X-SingMyKey-Comfort-High-Note"),
      comfortLowNote: response.headers.get("X-SingMyKey-Comfort-Low-Note"),
      processingMode: response.headers.get("X-SingMyKey-Processing-Mode"),
    },
  };
}

export async function mixRecording({
  accompanimentBlob,
  accompanimentFileName,
  accompanimentGainDb = -4,
  vocalBlob,
  vocalFileName,
  vocalGainDb = 0,
}) {
  const formData = new FormData();

  formData.append(
    "accompaniment_file",
    new File([accompanimentBlob], accompanimentFileName, { type: "audio/wav" }),
  );
  formData.append(
    "vocal_file",
    new File([vocalBlob], vocalFileName, { type: "audio/wav" }),
  );
  formData.append("accompaniment_gain_db", String(accompanimentGainDb));
  formData.append("vocal_gain_db", String(vocalGainDb));

  const response = await fetch(`${API_BASE_URL}/api/mix-recording`, {
    body: formData,
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Failed to export mixed song."));
  }

  return {
    blob: await response.blob(),
    fileName:
      response.headers.get("Content-Disposition")?.match(/filename="?([^"]+)"?/)?.[1] ??
      "singmykey_mix.wav",
  };
}
