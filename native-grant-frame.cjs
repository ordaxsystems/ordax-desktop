'use strict';

// A WebContents is a container, not a security principal for every iframe.
// Native grants belong only to the currently loaded canonical main frame.
// Electron 40 supplies details.frame but not the later initiatorOrigin API.
function isTrustedNativeRequest({
  details,contentsId,mainFrame,activeUrl,allowedOrigin,
}={}) {
  if(!details || !Number.isInteger(contentsId) ||
     details.webContentsId!==contentsId ||
     !mainFrame || details.frame!==mainFrame ||
     typeof allowedOrigin!=='string' || !allowedOrigin)
    return false;
  try {
    const destination=new URL(details.url);
    const current=new URL(activeUrl);
    const requestingFrame=new URL(mainFrame.url);
    return destination.origin===allowedOrigin &&
      current.origin===allowedOrigin &&
      requestingFrame.origin===allowedOrigin;
  }catch{
    // During navigation or frame destruction, denying grants is safe.
    return false;
  }
}
module.exports={isTrustedNativeRequest};