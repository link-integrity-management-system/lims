const { spawn } = require("node:child_process");

const whois = require("whois");
const date_fns = require("date-fns");
const Bottleneck = require("bottleneck/es5");

// const config = require("/home/ubuntu/app/configs/config");
const dbi = require("/home/ubuntu/app/shared/database_js/dbiface");
const utils = require("/home/ubuntu/app/shared/utils_js/utils");
const { VERIFY_FN_UTILS } = require("/home/ubuntu/app/shared/utils_js/verify_utils");

const TLS_ERROR_CODES = new Set([
    "ECONNRESET", // TLS handshake failures can cause this
    "EPROTO", // protocol error
    "ERR_TLS_CERT_ALTNAME_INVALID", // SAN does not match domain
    "ECERTCOMMONNAMEINVALID", // CN does not match domain
    "SELF_SIGNED_CERT_IN_CHAIN",
    "ERR_SSL_VERSION_OR_CIPHER_MISMATCH",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "ERR_TLS_HANDSHAKE_TIMEOUT",
    "ERR_TLS_REQUIRED_CIPHER_MISSING",
    "ERR_SSL_CERT_AUTHORITY_INVALID",
]);

const HTTP_CLIENTS = {
    AXIOS: "axios",
    CURL_IMPERSONATE: "curl_impersonate",
    BROWSER: "browser",
};

const REF_COORDS = {
    latitude: 40.902771,
    longitude: -73.133850,
}

const BINARY_CURL_IMPERSONATE = "/home/ubuntu/app/curl-impersonate/curl_chrome116";
const LIMITER_DELAY = 1500;
const LIMITERS = {
    RANK: new Bottleneck({
        maxConcurrent: 1,
        minTime: LIMITER_DELAY,
    }),
    DISTANCE: new Bottleneck({
        maxConcurrent: 1,
        minTime: LIMITER_DELAY,
    }),
    WHOIS: new Bottleneck({
        maxConcurrent: 1,
        minTime: LIMITER_DELAY,
    }),
};


async function sendRequest(url, clients, which) {
    const client = which ? which : HTTP_CLIENTS.CURL_IMPERSONATE;
    if (client === HTTP_CLIENTS.AXIOS) {
        return new Promise((resolve, reject) => {
            clients["axios"].get(url)
                .then(response => {
                    // Resolve the promise with the response data
                    resolve(response.data);
                })
                .catch(error => {
                    reject(error);
                });
        }
        );
    } else if (client === HTTP_CLIENTS.CURL_IMPERSONATE) {
        const binary = client === HTTP_CLIENTS.CURL ?
            BINARY_CURL :
            BINARY_CURL_IMPERSONATE;
        const runProcess = await utils.runProcess(
            binary,
            [url],
            {},
            5000,
        );
        const stdout = runProcess.stdout.trim();
        return stdout;
    }
}

async function queryWHOIS(domain) {
    const opts = {
        follow: 3,
    };
    return new Promise((resolve, reject) => {
        whois.lookup(domain, opts, (err, data) => {
            if (err) {
                return reject(err);
            }
            resolve(data);
        });
    });
}

// async function queryWHOIS(domain) {
//     // Step 1: Query IANA WHOIS server to get the authoritative WHOIS server for the TLD
//     const ianaOpts = {
//         server: 'whois.iana.org', // IANA WHOIS server
//         follow: 0, // No need to follow referrals here, just get the TLD server
//     };

//     try {
//         const ianaData = await new Promise((resolve, reject) => {
//             whois.lookup(domain, ianaOpts, (err, data) => {
//                 if (err) {
//                     return reject(err);
//                 }
//                 resolve(data);
//             });
//         });

//         // Extract the authoritative WHOIS server from the IANA response
//         const whoisServerMatch = ianaData.match(/whois:\s+(.+)/);
//         if (!whoisServerMatch) {
//             throw new Error('Unable to find authoritative WHOIS server from IANA');
//         }

//         const whoisServer = whoisServerMatch[1].trim();

//         // Step 2: Query the authoritative WHOIS server for the domain details
//         const opts = {
//             server: whoisServer, // Use the authoritative WHOIS server from IANA
//             follow: 3, // Allow for up to 3 referrals if necessary
//         };

//         const domainData = await new Promise((resolve, reject) => {
//             whois.lookup(domain, opts, (err, data) => {
//                 if (err) {
//                     return reject(err);
//                 }
//                 resolve(data);
//             });
//         });

//         // Step 3: Check if there is a referral to the registrar's WHOIS server
//         const registrarWhoisMatch = domainData.match(/Registrar WHOIS Server:\s*(.+)/);
//         if (registrarWhoisMatch) {
//             const registrarWhois = registrarWhoisMatch[1].trim();

//             // Step 4: Query the registrar's WHOIS server
//             const registrarData = await new Promise((resolve, reject) => {
//                 whois.lookup(domain, { server: registrarWhois }, (err, data) => {
//                     if (err) {
//                         return reject(err);
//                     }
//                     resolve(data);
//                 });
//             });

//             return registrarData; // Return the registrar's WHOIS data
//         } else {
//             // If no registrar WHOIS is found, return the domain data from the authoritative WHOIS server
//             return domainData;
//         }

//     } catch (error) {
//         throw new Error(`WHOIS query failed: ${error.message}`);
//     }
// }

async function queryDomainRank(clients, domain) {
    async function _queryTranco(url, clients, client) {
        const resp = await LIMITERS.RANK.schedule(
            () => sendRequest(url, clients, client)
        );
        const parsed = client == HTTP_CLIENTS.AXIOS ? resp : JSON.parse(resp);
        return parsed;
    }

    const tld = utils.getTLD(domain);
    const eTLD1 = utils.getETLDPlus1(domain);
    const baseUrl = `https://tranco-list.eu/api/ranks/domain`;
    const client = HTTP_CLIENTS.AXIOS;

    let resp = null;
    // if eTLD+1 is null, that means domain is an eTLD
    let domainToQuery = eTLD1 != null ? eTLD1 : domain;
    while (domainToQuery != null && domainToQuery != tld) {
        const url = `${baseUrl}/${domainToQuery}`;
        resp = await _queryTranco(url, clients, client);
        if (resp["ranks"].length == 0) {
            domainToQuery = utils.getParentDomain(domainToQuery);
        } else {
            break;
        }
    }

    // domain is not ranked
    if (resp["ranks"].length == 0) {
        return null;
    }

    // domain is ranked
    return resp["ranks"][0]["rank"];
}

// TODO:
async function queryDistance(clients, refCoords, domain) {
    try {
        const addresses = await VERIFY_FN_UTILS.resolveDomain(domain);
        const url = `https://ipinfo.io/${addresses[0]}/json`;
        const resp = await LIMITERS.DISTANCE.schedule(() => sendRequest(url, clients));
        const coords2Str = typeof (resp) === "string" ? JSON.parse(resp)["loc"] : resp["loc"];
        const coords2 = {
            latitude: Number(coords2Str.split(",")[0]),
            longitude: Number(coords2Str.split(",")[1]),
        };
        return VERIFY_FN_UTILS.haversineDistance(refCoords, coords2);
    } catch (err) {
        console.debug(`err: ${err}`);
        return null;
    }
}

async function parseWHOIS(domain) {
    const data = await LIMITERS.WHOIS.schedule(
        () => queryWHOIS(domain)
    );
    let parsed = {};

    const singleMatchRegexes = {
        "creationDate": /Creation Date:\s*(.*)/i,
        "expirationDate": /Expiration Date:\s*(.*)/i,
    }

    for (const [key, val] of Object.entries(singleMatchRegexes)) {
        const match = data.match(val);
        parsed[key] = match ? date_fns.parseISO(match[1]) : null;
    }

    // Parse all Domain Status lines
    const domainStatusRegexGlobal = /Domain Status:\s*(.*)/gi;
    let domainStatuses = [];
    let match;
    while ((match = domainStatusRegexGlobal.exec(data)) !== null) {
        domainStatuses.push(match[1]);
    }
    parsed["domainStatuses"] = domainStatuses;

    return parsed;
}

// Purpose: block requests to recently registered domains
//   verifyFnOutput -> false (= domain is recently reg.)
//   extraArgs: { threshold: integer }
async function isDomainRecentlyRegistered(fnArgs) {
    const { link, extraArgs } = fnArgs;
    const { threshold } = extraArgs;
    const domain = utils.getETLDPlus1(new URL(link.urlTarget).hostname);
    const parsedWHOIS = await parseWHOIS(domain);
    const creationDate = parsedWHOIS["creationDate"];

    let ret = false;
    if (creationDate) {
        const diffInDays = date_fns.differenceInDays(new Date(), creationDate);
        ret = diffInDays < threshold;
    }

    return {
        output: ret,
        policyDataLinkVals: null,
    };
}

// Purpose: block requests to domains that are about to drop
// verifyFnOutput -> false (= domain is dropping)
// extraArgs: { threshold: integer }
async function isDomainDropping(fnArgs) {
    const { link, extraArgs } = fnArgs;
    const { threshold } = extraArgs;
    const domain = utils.getETLDPlus1(new URL(link.urlTarget).hostname);
    const parsedWHOIS = await parseWHOIS(domain);
    const expirationDate = parsedWHOIS["expirationDate"];

    let ret = false;
    if (expirationDate) {
        const diffInDays = date_fns.differenceInDays(expirationDate, new Date());
        ret = diffInDays < threshold;
    }

    return {
        output: ret,
        policyDataLinkVals: null,
    };
}

// Purpose: 
//   verifyFnOutput -> false (= is low ranked)
//   extraArgs: { threshold: integer }
async function isDomainLowRanked(fnArgs) {
    const { clients, link, extraArgs } = fnArgs;
    const { threshold } = extraArgs;
    const domain = new URL(link.urlTarget).hostname;
    const rank = await queryDomainRank(clients, domain);
    return {
        output: rank === null || rank >= threshold,
        policyDataLinkVals: null,
    };
}

// Purpose: ensure that content parses correctly
//   verifyFnOutput -> true (= parses correctly)
//   extraArgs: { }
async function verifyContentWithType(fnArgs) {
    const { link } = fnArgs;
    const url = new URL(link.urlTarget);

}

// Purpose: ensure no TLS connection errors
// Benefit over CSP: automatic flagging to administrators
//   verifyFnOutput -> true (= no errors)
//   extraArgs: { }
async function commsHealthyTLS(fnArgs) {
    const { clients, link } = fnArgs;
    const url = new URL(link.urlTarget);
    try {
        await sendRequest(url, clients, HTTP_CLIENTS.AXIOS);
        return {
            output: true,
            policyDataLinkVals: null,
        };
    } catch (err) {
        if (TLS_ERROR_CODES.has(err.code)) {
            return {
                output: false,
                policyDataLinkVals: null,
            };
        }
        return {
            output: true,
            policyDataLinkVals: null,
        };
    }
}

// Purpose: enable geo-restriction
//   verifyFnOutput -> true (= wthin specified distance)
//   extraArgs: { threshold: float }
async function commsWithinDistance(fnArgs) {
    const { clients, link, extraArgs } = fnArgs;
    const { threshold } = extraArgs;

    const domain = utils.getETLDPlus1(new URL(link.urlTarget).hostname);
    const distance = await queryDistance(clients, REF_COORDS, domain);

    return {
        output: distance != null && distance <= threshold,
        policyDataLinkVals: null,
    };
}

// Purpose: detect new obfuscated block
//   verifyFnOutput -> false (= no obfuscated append)
//   extraArgs: { 
//      refresh: bool,
//      threshold : integer 
//  }
async function detectObfuscatedAppend(fnArgs) {
    const { clients, link, policy, extraArgs } = fnArgs;
    const { refresh, threshold } = extraArgs;
    const url = new URL(link.urlTarget);
    const currentContent = await sendRequest(url, clients);

    const dataVals = await dbi.getPolicyDataLinkVals(policy, link);
    const priorContent = dataVals["priorContent"];
    dataVals["priorContent"] = currentContent;

    // Update the policy link data document
    if (refresh || priorContent == undefined) {
        // await dbi.updatePolicyDataLinkVals(policy, link, dataVals);
        return {
            output: false,
            policyDataLinkVals: dataVals,
        };
    }

    if (currentContent === priorContent) {
        return {
            output: false,
            policyDataLinkVals: null,
        };
    }

    // content is different
    let retval = false;
    const bPriorContent = VERIFY_FN_UTILS.beautifyJavaScript(priorContent);
    const bCurrContent = VERIFY_FN_UTILS.beautifyJavaScript(currentContent);
    const diffIsAddition = VERIFY_FN_UTILS.getDiff(bPriorContent, bCurrContent);

    let isObfuscatedAppend = false;
    if (diffIsAddition.getDiff) {
        const detections = VERIFY_FN_UTILS.detectObfuscationFromDiff(diffIsAddition.diff, threshold);
        for (const detection of detections) {
            if (detection.result.isLikelyObfuscated) {
                isObfuscatedAppend = true;
            }
        }
    }

    if (isObfuscatedAppend) {
        dataVals["obfuscatedBlock"] = diffIsAddition.diff;
        retval = true;
    } else {
        dataVals["obfuscatedBlock"] = "";
        retval = false;
    }

    // await dbi.updatePolicyDataLinkVals(policy, link, dataVals);
    return {
        output: retval,
        policyDataLinkVals: dataVals,
    };
}

// Purpose: detect changed script dependencies
//   verifyFnOutput -> false (= did not change)
//   extraArgs: { 
//       refresh: bool, 
//       allowed: list(domain: string),
//   }
async function detectChangedDependencies(fnArgs) {
    const { link, policy, extraArgs } = fnArgs;
    const { refresh } = extraArgs;
    const url = link.urlTarget;

    const dataVals = await dbi.getPolicyDataLinkVals(policy, link);
    const allowed = dataVals["allowed"];
    const reqsByInitiator = await VERIFY_FN_UTILS.extractRequestsByInitiator(link.urlSource, url);
    const currDependencies = reqsByInitiator.map((x) => x.url);
    dataVals["allowed"] = currDependencies;

    // Update the policy link data document
    if (refresh || allowed == undefined) {
        // await dbi.updatePolicyDataLinkVals(policy, link, dataVals);
        return {
            output: false,
            policyDataLinkVals: dataVals,
        };
    }

    // just make sure the dependencies are the same
    const expected = new Set(allowed);
    const actual = new Set(currDependencies);
    const hasChanged = !VERIFY_FN_UTILS.setsAreEqual(expected, actual);
    return {
        output: hasChanged,
        policyDataLinkVals: null,
    };
}

const BUILDING_BLOCKS_MAP = {
    "recently_registered": isDomainRecentlyRegistered,
    "domain_dropping": isDomainDropping,
    "domain_rank": isDomainLowRanked,
    // "verified_type": verifyContentWithType,
    // "obfuscated_append": detectObfuscatedAppend,
    "changed_dependencies": detectChangedDependencies,
    "comms_tls": commsHealthyTLS,
    "comms_distance": commsWithinDistance,
}

module.exports = {
    BUILDING_BLOCKS_MAP: BUILDING_BLOCKS_MAP,
    HELPERS: {
        sendRequest: sendRequest,
        queryWHOIS: queryWHOIS,
        queryDomainRank: queryDomainRank,
        queryDistance: queryDistance,
        parseWHOIS: parseWHOIS,
    },
    CONSTANTS: {
        HTTP_CLIENTS: HTTP_CLIENTS,
    }
}