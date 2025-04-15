import crypto from "crypto";

function getUTCDateSeconds(utcSeconds) {
    if (!utcSeconds) {
        return utcSeconds;
    }
    let time = new Date(0);
    time.setUTCSeconds(utcSeconds);
    return time;
}

function getScriptHashDigest(scriptSource) {
    if (!scriptSource) {
        return null;
    }
    return crypto.createHash("sha256").update(scriptSource).digest("base64");
}

function getInitiatorUrls(initiator) {
    let initUrls = [];
    if (!initiator.url && initiator.stack) {
        const callFrames = initiator.stack.callFrames;
        for (let frame of callFrames) {
            if (frame.url) {
                initUrls.push(frame.url);
                // initUrls.push(`${frame.url} ${frame.lineNumber}`);
            }
        }
    } else {
        const url = initiator.url ? initiator.url : undefined;
        initUrls.push(url);
    }
    return initUrls;
}


export default {
    getUTCDateSeconds,
    getScriptHashDigest,
    getInitiatorUrls,
}