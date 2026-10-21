// Clicking the toolbar button (or pressing Alt+P) counts as a user gesture,
// which is what requestPictureInPicture() needs to be allowed.
chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: toggleFloatingVideo,
  });
});

// Runs inside the page.
async function toggleFloatingVideo() {
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

  try {
    await video.requestPictureInPicture();
  } catch (err) {
    console.warn("Float Video:", err);
  }
}
