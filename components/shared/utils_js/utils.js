import { spawn } from "child_process";

import crypto from "crypto";
import zlib from "zlib";

import config from "/home/ubuntu/app/configs/config.js";
import models from "/home/ubuntu/app/shared/database_js/models.js";

import { DateTime } from "luxon";
import psl from "psl";


/**
 * Get the eTLD+1 from a domain name
 * @param {string} domain - The domain name to parse
 * @returns {string|null} - The eTLD+1 or null if the domain is invalid
 */
function getETLDPlus1(domain) {
    // Use the psl.parse method to parse the domain
    const parsed = psl.parse(domain);

    // Return the eTLD+1 if it exists
    return parsed.domain;
}

function getETLD(domain) {
    const parsed = psl.parse(domain);
    return parsed.tld;
}

function getParentDomain(domain) {
    const firstDot = domain.indexOf(".");
    if (firstDot == -1) {
        return null;
    }
    return domain.substring(firstDot + 1);
}

function getUrlWithoutScheme(url) {
    if (!url) {
        return undefined;
    }
    const schemaSep = "://";
    var len = url.indexOf(schemaSep) + schemaSep.length;
    if (url.indexOf(schemaSep) == -1) {
        len = 0;
    }
    return url.substring(len);
}

function getDomainName(url) {
    const withoutScheme = getUrlWithoutScheme(url);
    let firstPathSep = withoutScheme.indexOf("/");
    if (firstPathSep == -1) {
        firstPathSep = withoutScheme.length;
    }
    const domain = withoutScheme.substring(0, firstPathSep);
    return domain;
}

function countStringOccurrences(str, regex) {
    const matches = str.match(regex);
    return matches ? matches.length : 0;
}

function getTLDPlus1(url) {
    let urlStr = url.indexOf("://") > -1 ? url : "https://" + url;
    const urlObj = new URL(urlStr);
    let host = urlObj.hostname;
    while (countStringOccurrences(host, /\./g) > 1) {
        const index = host.indexOf(".");
        host = host.substring(index + 1);
    }
    return host;
}

function getTLD(domain) {
    return domain.substring(domain.lastIndexOf(".") + 1);
}

function isSubdomain(url, domains) {
    let isSubdomain = false;
    for (const domain of domains) {
        isSubdomain = isSubdomain || getTLDPlus1(url) === getTLDPlus1(domain);
    }
    return isSubdomain;
}

function chunkArray(array, chunkSize = 100) {
    var chunks = [];
    for (i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

function isDataURL(url) {
    return isValidURLObject(url) && new URL(url).protocol === "data:";
}

function getCurrentDate() {
    var today = new Date();
    var dd = String(today.getDate()).padStart(2, "0");
    var mm = String(today.getMonth() + 1).padStart(2, "0"); //January is 0!
    var yyyy = today.getFullYear();

    today = yyyy + "_" + mm + "_" + dd;
    return today;
}

function compress(raw) {
    return config.compress ? zlib.gzipSync(raw).toString("base64") : raw;
}

function decompress(compressed) {
    const buf = Buffer.from(compressed, "base64");
    return config.compress ? zlib.gunzipSync(buf).toString() : compressed;
}

function isValidURLObject(url) {
    try {
        new URL(url);
        return true;
    } catch (err) { }
    return false;
}

function getUTCDateSeconds(utcSeconds) {
    if (!utcSeconds) {
        return utcSeconds;
    }
    let time = new Date(0);
    time.setUTCSeconds(utcSeconds);
    return time;
}

function fmtDateYMD(d) {
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function areTheSameDay(date1, date2) {
    return fmtDateYMD(date1) === fmtDateYMD(date2);
}

function getInitUrl(initRel) {
    return initRel.initUrl;
    // return initRel.initUrl ? initRel.initUrl.split(' ')[0] : null;
}

function isScript(info) {
    if (!info) {
        return undefined;
    }
    const urlObj = new URL(info.reqParams.request.url);
    const endsWithJS = urlObj.pathname.endsWith(".js");
    const isReqTypeScript = info.reqParams.type === "Script";
    const isRespTypeScript =
        info.respParams &&
        info.respParams.response &&
        info.respParams.response.mimeType &&
        info.respParams.response.mimeType.indexOf("javascript") > -1;
    const isRespContentTypeScript =
        info.respParams &&
        info.respParams.response &&
        info.respParams.response.headers &&
        info.respParams.response.headers["Content-Type"] &&
        info.respParams.response.headers["Content-Type"].indexOf("javascript") >
        -1;
    const check =
        endsWithJS ||
        isReqTypeScript ||
        isRespTypeScript ||
        isRespContentTypeScript;
    return check;
}

function annotateInitiatorForScript(requestedScripts, requestIdOrder) {
    const reversedIds = Array.from(requestIdOrder).reverse();
    const numReqs = Object.keys(requestedScripts).length;
    for (let idx1 = 0; idx1 < numReqs; idx1++) {
        const reqId1 = reversedIds[idx1];
        const info1 = requestedScripts[reqId1];
        for (let idx2 = idx1 + 1; idx2 < numReqs; idx2++) {
            const reqId2 = reversedIds[idx2];
            const info2 = requestedScripts[reqId2];
            const initRel1 = new models.InitiatorRel(info1.reqParams);
            const initUrl1 = getInitUrl(initRel1);
            if (
                info2.reqParams.request.url == initUrl1 &&
                (isScript(info1) || info1.isInitiator)
            ) {
                info2.isInitiator = true;
                continue;
            }
        }
    }
}

function getElapsedTimeFromLuxon(date) {
    return DateTime.now().diff(date).milliseconds;
}


function withTimeout(promise, timeoutTime, timeoutVal) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(timeoutVal), timeoutTime)
        )
    ]);
}

function withTimeoutAll(promises, timeoutTime, timeoutVal) {
    return Promise.allSettled(
        promises.map((promise) => withTimeout(promise, timeoutTime, timeoutVal))
    );
}


function promiseRaceAll(promises, timeoutTime, timeoutVal) {
    function promiseDelay(t, val) {
        return new Promise((resolve) => {
            setTimeout(resolve.bind(null, val), t);
        });
    }

    return Promise.all(
        promises.map((p) => {
            return Promise.race([p, promiseDelay(timeoutTime, timeoutVal)]);
        })
    );
}

function runProcess(command, args = [], options = {}, withTimeoutTime = 1000) {
    const processPromise = new Promise((resolve, reject) => {
        const child = spawn(command, args, options);

        // Capture stdout and stderr (optional)
        let stdoutData = '';
        let stderrData = '';

        child.stdout.on('data', (data) => {
            stdoutData += data;
        });

        child.stderr.on('data', (data) => {
            stderrData += data;
        });

        // Listen for the 'close' event
        child.on('close', (code) => {
            if (code === 0) {
                resolve({
                    code: code,
                    stdout: stdoutData,
                    stderr: stderrData
                });
            } else {
                reject({
                    code: code,
                    stdout: stdoutData,
                    stderr: stderrData
                });
            }
        });

        // Handle process errors
        child.on('error', (err) => {
            reject({
                code: null,
                error: err,
                stdout: stdoutData,
                stderr: stderrData
            });
        });
    });

    const promise = withTimeoutTime ?
        withTimeout(processPromise,
            withTimeoutTime,
            {
                code: null,
                stdout: null,
                stderr: null,
            }
        ) :
        processPromise;

    return promise;
}

function urlMatches(ptrn_str, url) {
    const ptrn = typeof ptrn_str === "string" ? new RegExp(ptrn_str) : ptrn_str;
    const matches = url.match(ptrn);
    return matches !== null;
}

function urlMatchesAny(ptrn_strs, url) {
    const ptrns = ptrn_strs.map((x) =>
        typeof x === "string" ? new RegExp(x) : x
    );
    const matches = ptrns.map((x) => url.match(x));
    return matches.some((x) => x === null);
}

function initKeyVal(obj, key, val) {
    if (!(key in obj)) {
        obj[key] = val;
    }
}

function hash(data) {
    return crypto.createHash("sha256").update(data).digest("base64");
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export default {
    getETLDPlus1,
    getETLD,
    getParentDomain,
    getDomainName,
    getTLDPlus1,
    getTLD,
    isSubdomain,
    chunkArray,
    isDataURL,
    getCurrentDate,
    compress,
    decompress,
    isValidURLObject,
    getUTCDateSeconds,
    fmtDateYMD,
    areTheSameDay,
    getInitUrl,
    isScript,
    annotateInitiatorForScript,
    getElapsedTimeFromLuxon,
    withTimeout,
    withTimeoutAll,
    promiseRaceAll,
    runProcess,
    urlMatches,
    urlMatchesAny,
    initKeyVal,
    hash,
    sleep,
};
