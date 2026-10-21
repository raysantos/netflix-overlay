// Clicking the toolbar button (or pressing Alt+P) counts as a user gesture,
// which is what opening a picture-in-picture window needs to be allowed.
// The script runs in the page's own world so it can reach Netflix's player API.
chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    world: "MAIN",
    func: toggleFloatingVideo,
  });
});

// Runs inside the page.
async function toggleFloatingVideo() {
  const dpip = window.documentPictureInPicture;
  if (dpip?.window) {
    dpip.window.close();
    return;
  }
  if (document.pictureInPictureElement) {
    await document.exitPictureInPicture();
    return;
  }

  // Pick the biggest video that is actually playing or loaded.
  const videos = [...document.querySelectorAll("video")]
    .filter((v) => v.readyState > 0)
    .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
  const video = videos[0];
  if (!video) return;

  // Netflix sets this to hide the browser's own PiP option.
  video.removeAttribute("disablePictureInPicture");
  video.disablePictureInPicture = false;

  // Browsers without Document PiP only get the bare video.
  if (!dpip) {
    try {
      await video.requestPictureInPicture();
    } catch (err) {
      console.warn("Float Video:", err);
    }
    return;
  }

  // Netflix crashes if currentTime is set directly, so seek through its player.
  const netflixPlayer = () => {
    try {
      const vp = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      return vp.getVideoPlayerBySessionId(vp.getAllPlayerSessionIds()[0]);
    } catch {
      return null;
    }
  };
  const seekTo = (seconds) => {
    seconds = Math.max(0, Math.min(seconds, video.duration || seconds));
    const nf = netflixPlayer();
    if (nf) nf.seek(seconds * 1000);
    else video.currentTime = seconds;
  };
  const togglePlay = () => {
    const nf = netflixPlayer();
    if (video.paused) nf ? nf.play() : video.play();
    else nf ? nf.pause() : video.pause();
  };

  const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
  let pip;
  try {
    pip = await dpip.requestWindow({ width: 560, height: Math.round(560 / aspect) });
  } catch (err) {
    console.warn("Float Video:", err);
    return;
  }

  const doc = pip.document;
  doc.title = "Float Video";
  doc.head.innerHTML = `<style>
    html, body { margin: 0; height: 100%; background: #000; overflow: hidden;
      font: 14px/1.3 system-ui, sans-serif; color: #fff; user-select: none; }
    video { position: absolute !important; inset: 0 !important; width: 100% !important;
      height: 100% !important; object-fit: contain !important; transform: none !important; }
    #cc { position: absolute; left: 6%; right: 6%; bottom: 14%; text-align: center;
      pointer-events: none; transition: bottom .2s; }
    #cc span { display: inline; white-space: pre-line; padding: .1em .35em;
      background: rgba(0,0,0,.65); font-size: clamp(14px, 4.4vw, 34px); font-weight: 600;
      line-height: 1.35; -webkit-box-decoration-break: clone; box-decoration-break: clone;
      text-shadow: 0 1px 2px #000; }
    #cc:empty { display: none; }
    #bar { position: absolute; left: 0; right: 0; bottom: 0; padding: 22px 10px 8px;
      background: linear-gradient(transparent, rgba(0,0,0,.8));
      display: flex; align-items: center; gap: 6px; opacity: 0; transition: opacity .2s; }
    body.ui #bar, body.paused #bar { opacity: 1; }
    body:not(.ui):not(.paused) { cursor: none; }
    body.ui #cc, body.paused #cc { bottom: 64px; }
    button { all: unset; cursor: pointer; width: 30px; height: 30px; display: grid;
      place-items: center; border-radius: 6px; font-size: 16px; }
    button:hover { background: rgba(255,255,255,.18); }
    button.off { opacity: .45; }
    #seek { flex: 1; accent-color: #e50914; cursor: pointer; min-width: 40px; }
    #time { font-variant-numeric: tabular-nums; font-size: 12px; opacity: .85; white-space: nowrap; }
  </style>`;
  doc.body.innerHTML = `
    <div id="cc"></div>
    <div id="bar">
      <button id="play" title="Play/pause (Space)"></button>
      <button id="back" title="Back 10s (←)">↺</button>
      <button id="fwd" title="Forward 10s (→)">↻</button>
      <input id="seek" type="range" min="0" max="1000" value="0">
      <span id="time"></span>
      <button id="mute" title="Mute (M)"></button>
      <button id="ccbtn" title="Captions (C)">CC</button>
      <button id="dock" title="Back to tab">⤢</button>
    </div>`;
  const $ = (id) => doc.getElementById(id);

  // Move the real video into the window and leave a marker to put it back.
  const marker = document.createComment("float-video");
  video.before(marker);
  doc.body.prepend(video);

  // Mirror captions. Netflix and YouTube draw them as page elements, other
  // sites mostly use the video's own text tracks.
  let showCaptions = true;
  const captionText = () => {
    const nf = [...document.querySelectorAll(".player-timedtext-text-container")];
    if (nf.length) return nf.map((el) => el.innerText.trim()).join("\n");
    const yt = document.querySelector(".ytp-caption-window-container");
    if (yt) return yt.innerText.trim();
    for (const track of video.textTracks) {
      if (track.mode === "showing" && track.activeCues?.length) {
        return [...track.activeCues].map((c) => c.text.replace(/<[^>]+>/g, "")).join("\n");
      }
    }
    return document.querySelector(".player-timedtext")?.innerText.trim() || "";
  };
  let lastCaption = null;
  const updateCaptions = () => {
    const text = showCaptions ? captionText() : "";
    if (text === lastCaption) return;
    lastCaption = text;
    $("cc").replaceChildren();
    if (text) {
      const span = doc.createElement("span");
      span.textContent = text;
      $("cc").append(span);
    }
  };

  const fmt = (s) => {
    s = Math.floor(s || 0);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
  };
  let dragging = false;
  const updateBar = () => {
    doc.body.classList.toggle("paused", video.paused);
    $("play").textContent = video.paused ? "▶" : "❚❚";
    $("mute").textContent = video.muted || video.volume === 0 ? "🔇" : "🔊";
    $("ccbtn").classList.toggle("off", !showCaptions);
    const d = video.duration;
    if (!dragging && isFinite(d) && d > 0) $("seek").value = (video.currentTime / d) * 1000;
    $("time").textContent = isFinite(d) ? `${fmt(video.currentTime)} / ${fmt(d)}` : fmt(video.currentTime);
  };

  // The PiP window stays visible when the tab is in the background, so its
  // timer keeps running even when the page's own timers are throttled.
  const tick = pip.setInterval(() => { updateCaptions(); updateBar(); }, 150);

  let hideTimer;
  const showUi = () => {
    doc.body.classList.add("ui");
    pip.clearTimeout(hideTimer);
    hideTimer = pip.setTimeout(() => doc.body.classList.remove("ui"), 2500);
  };
  doc.addEventListener("mousemove", showUi);
  doc.addEventListener("mouseleave", () => doc.body.classList.remove("ui"));

  $("play").onclick = togglePlay;
  $("back").onclick = () => seekTo(video.currentTime - 10);
  $("fwd").onclick = () => seekTo(video.currentTime + 10);
  $("mute").onclick = () => { video.muted = !video.muted; };
  $("ccbtn").onclick = () => { showCaptions = !showCaptions; lastCaption = null; };
  $("dock").onclick = () => pip.close();
  $("seek").oninput = () => { dragging = true; };
  $("seek").onchange = () => {
    dragging = false;
    seekTo(($("seek").value / 1000) * video.duration);
  };
  video.addEventListener("click", togglePlay);
  doc.addEventListener("keydown", (e) => {
    const actions = {
      " ": togglePlay,
      k: togglePlay,
      ArrowLeft: () => seekTo(video.currentTime - 10),
      ArrowRight: () => seekTo(video.currentTime + 10),
      m: () => $("mute").onclick(),
      c: () => $("ccbtn").onclick(),
    };
    const action = actions[e.key];
    if (action) {
      e.preventDefault();
      action();
      showUi();
    }
  });

  updateBar();
  showUi();

  // Closing the window puts the video back where it was.
  pip.addEventListener("pagehide", () => {
    pip.clearInterval(tick);
    video.removeEventListener("click", togglePlay);
    if (marker.isConnected) marker.replaceWith(video);
    else document.body.append(video);
  }, { once: true });
}
