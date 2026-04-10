import { useEffect, useState } from "react";
import { SongProcessor } from "./components/SongProcessor";
import { VocalRangeTester } from "./components/VocalRangeTester";
import { fetchHealth, fetchVocalProfile } from "./lib/api";

const PROFILE_STORAGE_KEY = "singmykey.profileId";
const FLOW_STEPS = [
  {
    description:
      "\u5148\u7528\u7a33\u5b9a\u957f\u97f3\u6d4b\u51fa\u4f60\u7684\u8212\u9002\u97f3\u57df\uff0c\u4fdd\u5b58\u540e\u540e\u9762\u4f1a\u81ea\u52a8\u5957\u7528\u3002",
    id: "profile",
    title: "\u6d4b\u97f3\u57df",
  },
  {
    description:
      "\u4e0a\u4f20\u4e00\u9996\u6b4c\uff0c\u751f\u6210\u66f4\u9002\u5408\u4f60\u5531\u7684\u4f34\u594f\u7248\u672c\u3002",
    id: "song",
    title: "\u751f\u6210\u4f34\u594f",
  },
  {
    description:
      "\u6234\u8033\u673a\u76f4\u63a5\u8ddf\u5531\uff0c\u5f55\u5b8c\u540e\u5408\u6210\u5e76\u5bfc\u51fa\u6210\u54c1\u3002",
    id: "sing",
    title: "\u8ddf\u5531\u5bfc\u51fa",
  },
];

function App() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");
  const [savedProfile, setSavedProfile] = useState(null);
  const [profileStatus, setProfileStatus] = useState("idle");

  useEffect(() => {
    async function loadHealth() {
      try {
        const response = await fetchHealth();
        setHealth(response);
      } catch (requestError) {
        setError(requestError.message);
      }
    }

    loadHealth();
  }, []);

  useEffect(() => {
    const savedProfileId = window.localStorage.getItem(PROFILE_STORAGE_KEY);

    if (!savedProfileId) {
      return;
    }

    async function loadProfile() {
      setProfileStatus("loading");

      try {
        const profile = await fetchVocalProfile(savedProfileId);
        setSavedProfile(profile);
        setProfileStatus("ready");
      } catch (requestError) {
        window.localStorage.removeItem(PROFILE_STORAGE_KEY);
        setProfileStatus("error");
      }
    }

    loadProfile();
  }, []);

  function handleProfileSaved(profile) {
    setSavedProfile(profile);
    setProfileStatus("ready");
    window.localStorage.setItem(PROFILE_STORAGE_KEY, profile.id);
  }

  const activeStepId =
    profileStatus === "loading"
      ? "profile"
      : savedProfile
        ? "song"
        : "profile";

  return (
    <main className="min-h-screen bg-slate-950 px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[max(1rem,env(safe-area-inset-top))] text-slate-50 sm:px-6 sm:py-16">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 sm:gap-8">
        <header className="space-y-4">
          <p className="text-sm uppercase tracking-[0.3em] text-cyan-400">
            SingMyKey
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            {"\u7528\u58f0\u97f3\u76f4\u63a5\u6d4b\u51fa\u4f60\u7684\u53ef\u5531\u97f3\u57df"}
          </h1>
          <p className="max-w-2xl text-base text-slate-300 sm:text-lg">
            {"\u8fd9\u4e2a\u9875\u9762\u5df2\u7ecf\u63a5\u5165\u4e00\u4e2a\u524d\u7aef\u97f3\u9ad8\u68c0\u6d4b\u7ec4\u4ef6\uff0c\u53ef\u4ee5\u5b9e\u65f6\u663e\u793a\u4f60\u5531\u51fa\u7684\u97f3\u540d\uff0c\u5e76\u8bb0\u5f55\u7a33\u5b9a\u7684\u6700\u9ad8\u97f3\u548c\u6700\u4f4e\u97f3\u3002"}
          </p>
        </header>

        <section className="rounded-3xl border border-cyan-400/20 bg-cyan-400/5 p-5">
          <div className="space-y-3">
            <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">
              Mobile Flow
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-50">
              {"\u5728 iPhone \u4e0a\u5c31\u6309\u8fd9 3 \u6b65\u5b8c\u6210"}
            </h2>
            <p className="text-sm text-slate-300">
              {"\u624b\u673a\u53ea\u8d1f\u8d23\u6d4b\u8bd5\u3001\u4e0a\u4f20\u3001\u5f55\u97f3\u548c\u5bfc\u51fa\uff0c\u540e\u7aef\u5219\u8d1f\u8d23\u4eba\u58f0\u5206\u79bb\u3001\u8f6c\u8c03\u548c\u6df7\u97f3\u3002"}
            </p>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {FLOW_STEPS.map((step, index) => {
              const isActive = activeStepId === step.id;
              const isCompleted = savedProfile && step.id === "profile";

              return (
                <div
                  className={`rounded-2xl border p-4 transition ${
                    isActive
                      ? "border-cyan-300/60 bg-cyan-300/10"
                      : "border-slate-800 bg-slate-900/80"
                  }`}
                  key={step.id}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs uppercase tracking-[0.3em] text-slate-500">
                      {`0${index + 1}`}
                    </span>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        isCompleted
                          ? "bg-emerald-300 text-slate-950"
                          : isActive
                            ? "bg-cyan-300 text-slate-950"
                            : "bg-slate-800 text-slate-300"
                      }`}
                    >
                      {isCompleted
                        ? "\u5df2\u5b8c\u6210"
                        : isActive
                          ? "\u5f53\u524d"
                          : "\u5f85\u7ee7\u7eed"}
                    </span>
                  </div>
                  <p className="mt-3 text-lg font-semibold text-slate-100">
                    {step.title}
                  </p>
                  <p className="mt-2 text-sm text-slate-400">
                    {step.description}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
          <p className="text-sm uppercase tracking-[0.35em] text-amber-300">
            iPhone Tips
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-300">
              {"\u5f55\u6b4c\u65f6\u5c3d\u91cf\u6234\u8033\u673a\uff0c\u907f\u514d\u4f34\u594f\u4e32\u8fdb\u9ea6\u514b\u98ce\u3002"}
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-300">
              {"\u8ddf\u5531\u5f55\u97f3\u65f6\u4e0d\u8981\u5207\u5230\u540e\u53f0\uff0c\u4fdd\u6301\u9875\u9762\u4eae\u5c4f\u66f4\u7a33\u3002"}
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-300">
              {"\u9996\u6b21\u4f7f\u7528\u53ef\u4ee5\u5728 Safari \u91cc\u201c\u6dfb\u52a0\u5230\u4e3b\u5c4f\u5e55\u201d\uff0c\u4e0b\u6b21\u5c31\u50cf App \u4e00\u6837\u6253\u5f00\u3002"}
            </div>
          </div>
        </section>

        {profileStatus === "loading" ? (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-300">
            {"\u6b63\u5728\u8bfb\u53d6\u4f60\u4e4b\u524d\u4fdd\u5b58\u7684\u97f3\u57df\u6863\u6848..."}
          </section>
        ) : null}

        {profileStatus === "error" ? (
          <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-sm text-amber-100">
            {"\u4e4b\u524d\u4fdd\u5b58\u7684\u97f3\u57df\u6863\u6848\u672a\u80fd\u8bfb\u53d6\uff0c\u4f60\u53ef\u4ee5\u91cd\u65b0\u6d4b\u8bd5\u5e76\u4fdd\u5b58\u4e00\u6b21\u3002"}
          </section>
        ) : null}

        <VocalRangeTester
          onProfileSaved={handleProfileSaved}
          savedProfile={savedProfile}
        />

        <SongProcessor profile={savedProfile} profileStatus={profileStatus} />

        <section className="hidden rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl shadow-slate-950/40 md:block">
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">
            API health
          </p>
          <div className="mt-4">
            {health ? (
              <div className="space-y-2">
                <p className="text-2xl font-semibold text-emerald-400">
                  {health.status}
                </p>
                <p className="text-slate-300">{health.service}</p>
              </div>
            ) : error ? (
              <div className="space-y-2">
                <p className="text-2xl font-semibold text-rose-400">error</p>
                <p className="text-slate-300">{error}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-2xl font-semibold text-amber-300">
                  checking
                </p>
                <p className="text-slate-300">
                  Waiting for the backend health endpoint.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export default App;
