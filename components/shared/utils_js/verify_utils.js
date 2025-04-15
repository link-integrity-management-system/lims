// const util = require("node:util");
// const exec = util.promisify(require("node:child_process").exec);
const { spawn } = require("node:child_process");
// const stream = require("node:stream/promises");
const dns = require("dns").promises;
const puppeteer = require('puppeteer');

const beautify = require('js-beautify').js;
const Diff = require('diff');

const utils = require("/home/ubuntu/app/shared/utils_js/utils");

const WORKER_TYPES = {
    COLLECTOR: "Collector",
    VERIFIER: "Verifier",
};

const VERIFICATION_STRATEGY = {
    SIMPLE: "simple",
    BUILDING_BLOCK: "building_block",
};

async function isTrustedDomain(domain) {
    return ["code.jquery.com", "images.unsplash.com"].includes(domain);
}

/**
 * Resolve a domain to its IP addresses.
 * @param {string} domain - The domain name to resolve.
 * @param {string} recordType - The type of DNS record to resolve (default: 'A').
 * @returns {Promise<string[]>} - A promise that resolves to an array of IP addresses.
 */
async function resolveDomain(domain, recordType = 'A') {
    try {
        const addresses = await dns.resolve(domain, recordType);
        return addresses;
    } catch (err) {
        throw new Error(`Error resolving domain ${domain}: ${err.message}`);
    }
}


function getHash(data) {
    return utils.hash(data);
}

function getScriptAST(script) {
    return "scriptAST";
}

// function getSicilianSig(script) {
//     return "sicilianSig";
// }

async function getSicilianSig(script) {
    const proc = spawn("python3", ["src/sicilian.py"]);
    let stdout = "";
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (data) => {
        stdout += data;
    });
    const promiseFinish = new Promise((resolve) => {
        proc.on("close", (code) => {
            resolve(code);
        }
    )});
    proc.stdin.end(script);
    // const stdinStream = new stream.Readable();
    // stdinStream.push(script);
    // stdinStream.push(null); // send EOF
    // stdinStream.pipe(proc.stdin);
    await utils.promiseRaceAll([promiseFinish], 5000, null);
    const ret = stdout.trim();
    return ret;
}


function setsAreEqual(setA, setB) {
    if (setA.size !== setB.size) {
      return false; // Different sizes, so they are not equal
    }
  
    for (let item of setA) {
      if (!setB.has(item)) {
        return false; // Found an item in setA that is not in setB
      }
    }
  
    return true; // All checks passed, sets are equal
}


/**
 * Calculate the distance between two geographical points using the Haversine formula.
 *
 * @param {Object} coords1 - The first coordinate point.
 * @param {number} coords1.latitude - The latitude of the first point in decimal degrees.
 * @param {number} coords1.longitude - The longitude of the first point in decimal degrees.
 * @param {Object} coords2 - The second coordinate point.
 * @param {number} coords2.latitude - The latitude of the second point in decimal degrees.
 * @param {number} coords2.longitude - The longitude of the second point in decimal degrees.
 * @returns {number} - The distance between the two points in kilometers.
 *
 * @throws {Error} - Throws an error if the coordinates are not valid numbers.
 */
function haversineDistance(coords1, coords2) {
    // Helper function to convert degrees to radians
    const toRadians = (degrees) => degrees * (Math.PI / 180);
  
    // Convert latitude and longitude from degrees to radians
    const lat1 = toRadians(coords1.latitude);
    const lon1 = toRadians(coords1.longitude);
    const lat2 = toRadians(coords2.latitude);
    const lon2 = toRadians(coords2.longitude);
  
    // Calculate differences in coordinates
    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;
  
    // Apply the Haversine formula
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(dLon / 2) ** 2;
  
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    const R = 6371; // Radius of the Earth in kilometers
    const distance = R * c; // Distance in kilometers
  
    return distance; // Returns the calculated distance
}


/**
 * Function to beautify JavaScript code
 * 
 * @param {string} jsCode - The JavaScript code to beautify.
 * @param {Object} [options={}] - Optional configuration for beautification.
 * @returns {string} - Returns the beautified JavaScript code.
 */
function beautifyJavaScript(jsCode, options = {}) {
    // Default options for beautification
    const defaultOptions = {
        indent_size: 4, // Number of spaces for indentation
        space_in_empty_paren: true, // Add space inside empty parentheses
        preserve_newlines: true, // Preserve existing newlines
        max_preserve_newlines: 2 // Maximum number of newlines to preserve
    };

    // Merge provided options with the defaults
    const finalOptions = { ...defaultOptions, ...options };

    // Beautify and return the formatted code
    return beautify(jsCode, finalOptions);
}


/**
 * Check if the diff between two strings consists only of additions.
 *
 * @param {string} oldStr - The original string.
 * @param {string} newStr - The modified string.
 * @returns {boolean} - Returns true if the diff is strictly additions; otherwise, false.
 */
function getDiff(oldStr, newStr) {
    const diffs = Diff.diffLines(oldStr, newStr);
  
    // Check if all changes are additions
    return {
        diffs: diffs,
        isStrictAddition: diffs.every(
            part => part.added || part.removed === false
        ),
    }
}

/**
 * Function to detect obfuscation in the changed parts of JavaScript code from a diff.
 * 
 * @param {Array} diff - The diff array from the diff module containing the code differences.
 * @returns {Array} - Returns an array of obfuscation detection results for the modified lines.
 */
function detectObfuscationFromDiff(diff, threshold) {
    const results = [];

    // Loop through each part of the diff
    diff.forEach(part => {
        if (part.added) {
            // Only check added parts for obfuscation
            const jsCode = part.value;
            const result = detectObfuscation(jsCode, threshold); // Use the detectObfuscation function
            results.push({
                changedCode: jsCode, // The added/modified code
                result // The result of the obfuscation detection
            });
        }
    });

    return results;
}

/**
 * Function to detect if a piece of JavaScript code appears obfuscated based on certain common patterns.
 * 
 * @param {string} jsCode - The JavaScript code to analyze.
 * @returns {Object} - Returns an object containing the obfuscation score, a boolean indicating if it's likely obfuscated,
 *                     and detailed breakdown of matches for specific patterns.
 */
function detectObfuscation(jsCode, threshold) {
    let score = 0; // Initialize score to track the suspiciousness level.
    let thresh = threshold ? threshold : 10;

    // Rule 1: Check for hex-encoded strings (e.g., \xNN) or Unicode escape sequences (e.g., \uNNNN)
    const hexPattern = /\\x[0-9A-Fa-f]{2}/g;    // Matches hex-encoded characters like \x64
    const unicodePattern = /\\u[0-9A-Fa-f]{4}/g; // Matches Unicode escape sequences like \u0041

    // Find matches for hex and Unicode patterns
    const hexMatches = jsCode.match(hexPattern) || [];
    const unicodeMatches = jsCode.match(unicodePattern) || [];

    // Increment score based on the number of hex and unicode sequences found
    score += hexMatches.length * 2;    // Give higher weight to these patterns
    score += unicodeMatches.length * 2;

    // Rule 2: Check for the usage of dangerous functions like eval, Function, or document.write
    const suspiciousFunctions = /(eval|Function|document\.write)/g;
    const suspiciousFuncMatches = jsCode.match(suspiciousFunctions) || [];

    // Increment score for each occurrence of dangerous functions
    score += suspiciousFuncMatches.length * 3; // Higher weight because these are often used in malicious code

    // Rule 3: Check for long variable or function names with no meaningful structure
    const longVarsPattern = /\b[a-zA-Z_]\w{10,}\b/g; // Matches variable names of 10+ characters
    const longVarsMatches = jsCode.match(longVarsPattern) || [];

    // Increment score based on the number of long variable/function names found
    score += longVarsMatches.length;

    // Rule 4: Calculate the ratio of non-alphanumeric characters to total characters.
    // High non-alphanumeric character ratio is a sign of obfuscation.
    const nonAlphaNum = jsCode.replace(/[a-zA-Z0-9]/g, "").length; // Count non-alphanumeric characters
    const alphaNum = jsCode.length - nonAlphaNum;                  // Count alphanumeric characters
    const nonAlphaRatio = nonAlphaNum / jsCode.length;             // Calculate non-alphanumeric to total length ratio

    // If more than 40% of the code is non-alphanumeric, increase the score
    if (nonAlphaRatio > 0.4) {
        score += Math.floor(nonAlphaRatio * 10); // Higher weight for very high non-alphanumeric ratios
    }

    // Return an object with the final score, a boolean indicating likelihood of obfuscation, and match details
    return {
        score, // The final suspiciousness score
        isLikelyObfuscated: score > thresh, // If score is above thresh, we consider the code likely obfuscated
        details: {
            hexMatches: hexMatches.length,         // Number of hex-encoded matches
            unicodeMatches: unicodeMatches.length, // Number of Unicode escape matches
            suspiciousFunctions: suspiciousFuncMatches.length, // Number of suspicious function calls
            longVariables: longVarsMatches.length, // Number of long variable/function names
            nonAlphaRatio: nonAlphaRatio.toFixed(2), // Ratio of non-alphanumeric characters
        }
    };
}

/**
 * Launches Chrome, navigates to the specified URL, and extracts network requests
 * that were initiated by a specific initiator URL.
 * 
 * @param {string} url - The URL to navigate to.
 * @param {string} initiatorUrl - The initiator URL to filter network requests.
 * @param {string} chromePath - The path to the Chrome executable (optional).
 * @returns {Promise<Array>} - A promise that resolves to an array of matching requests.
 */
async function extractRequestsByInitiator(
    url, 
    initiatorUrl, 
    chromePath = "/home/ubuntu/app/chrome-for-testing/chrome/linux-128.0.6613.137/chrome-linux64/chrome"
) {
    // Launch Puppeteer with adjusted flags to prevent crashes in Docker
    const browser = await puppeteer.launch({
        headless: true, // Run in headless mode (without a GUI)
        executablePath: chromePath,
        args: [
            '--no-sandbox',                  // Disable Chrome's sandboxing for better compatibility in Docker
            '--disable-setuid-sandbox',       // Disable setuid sandbox to avoid permission issues
            '--disable-dev-shm-usage',        // Use disk-based memory instead of /dev/shm (helps prevent crashes)
            '--disable-gpu',                  // Disable GPU rendering as it's not necessary in headless mode
            '--disable-software-rasterizer',  // Disable the software rasterizer when not using GPU
            '--headless=new'                  // Use the new headless mode (improves performance and compatibility)
        ]
    });

    // Create a new browser page
    const page = await browser.newPage();

    // Array to store requests matching the initiator URL
    let matchingRequests = [];

    // Event listener to capture network requests
    page.on('request', request => {
        const initiator = request.initiator();
        // console.debug(`found req ${request.url()} ${request.method()} ${initiator.url}`);

        // Check if the request's initiator matches the specified initiator URL
        if (initiator && initiator.url && initiator.url.includes(initiatorUrl)) {
            matchingRequests.push({
                url: request.url(),          // URL of the request
                method: request.method(),    // HTTP method (e.g., GET, POST)
                initiator: initiator.url     // URL that initiated the request
            });
        }
    });

    // Navigate to the provided URL and wait until the network is mostly idle
    await page.goto(url, { waitUntil: 'networkidle2' });

    // Close the browser after the page has loaded and requests have been captured
    await browser.close();

    // Return the list of matching requests
    return matchingRequests;
}

module.exports = {
    WORKER_TYPES: WORKER_TYPES,
    VERIFICATION_STRATEGY: VERIFICATION_STRATEGY,
    VERIFY_FN_UTILS: {
        isTrustedDomain: isTrustedDomain,
        resolveDomain: resolveDomain,
        getHash: getHash,
        getScriptAST: getScriptAST,
        getSicilianSig: getSicilianSig,
        setsAreEqual: setsAreEqual,
        haversineDistance: haversineDistance,
        beautifyJavaScript: beautifyJavaScript,
        getDiff: getDiff,
        detectObfuscationFromDiff: detectObfuscationFromDiff,
        detectObfuscation: detectObfuscation,
        extractRequestsByInitiator: extractRequestsByInitiator,
    },
};
