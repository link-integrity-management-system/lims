// const config = require("/home/ubuntu/app/configs/config");
// const Worker = require("/home/ubuntu/app/src/worker").Worker;

// const path = require("path");
// const util = require('util');
// const exec = util.promisify(require('child_process').exec);
// const os = require("os");
// const fs = require("fs/promises");
// const process = require("process");

const axios = require("axios").default;
const axiosRetry = require("axios-retry").default;
const dbi = require("/home/ubuntu/app/shared/database_js/dbiface");
// const Queue = require("bee-queue");
// const { DateTime } = require("luxon");

// const HCCrawler = require("/home/ubuntu/app/headless-chrome-crawler");
const utils = require("/home/ubuntu/app/shared/utils_js/utils");
const verify_utils = require("/home/ubuntu/app/shared/utils_js/verify_utils");
const policy_blocks = require("/home/ubuntu/app/src/policy_blocks");
// const dbi = require("/home/ubuntu/app/shared/database_js/dbiface");

// const WORKER_TYPES = verify_utils.WORKER_TYPES;
// const VERIFICATION_STRATEGY = verify_utils.VERIFICATION_STRATEGY;

class Verifier {
    constructor(settings) {
        this._settings = settings;
    }

    async _verify(opts) {
        // returns
        // {
        //     linkID: {
        //         "status": status,
        //         "verifications": verifications
        //     }
        // }
        throw new Error("_verify is not overridden!");
    }
}

class VerifierSimple extends Verifier {
    constructor(settings) {
        super(settings);
        this.retryErrorCodes = [
            403,    // service temp unavail
            429,    // rate limit exceeeded, tranco (1/s)
        ]
    }

    _getBaseAxios(domain) {
        if (!this._baseAxios) {
            this._baseAxios = axios.create({
                method: "get",
                timeout: this._settings.verifier.req_timeout,
                maxRedirects: 5,
                headers: {
                    "User-Agent": this._settings.user_agent,
                    Referer: domain,
                    ...this._settings.extra_headers,
                },
            });
            axiosRetry(this._baseAxios, {
                retries: 3, // Number of retries
                retryDelay: axiosRetry.linearDelay,
                retryCondition: (error) => {
                    // Retry only if response is 429
                    return error.response && error.response.status === 429;
                },
            });
        }
        return this._baseAxios;
    }

    async _verify(opts) {
        const { domain, policies, links } = opts;
        const ax = this._getBaseAxios(domain);
        const status = {};
        const policyDataLinksToUpdate = [];
        const AsyncFunction = Object.getPrototypeOf(
            async function () { }
        ).constructor;
        const buildingBlocksMap = policy_blocks.BUILDING_BLOCKS_MAP;
        for (const [policyID, policyLinks] of Object.entries(links)) {
            const policy = policies[policyID];
            // policy.verifyFn will either:
            // 1. be matched to a key in building blocks, or
            // 2. be a custom JS function to execute (prob not the best)
            const verifyFn = policy.verifyFn in buildingBlocksMap ?
                buildingBlocksMap[policy.verifyFn] :   // use building block
                new AsyncFunction(...policy.verifyFn); // else treat it as eval
            const outputExpected = policy.verifyFnOutput;
            for (const [linkID, link] of Object.entries(policyLinks)) {
                let outputActual = undefined;
                let policyDataLinkVals = null;
                let error = null;
                try {
                    const fnArgs = {
                        clients: {
                            axios: ax,
                        },
                        link: link,
                        utils: verify_utils.VERIFY_FN_UTILS,
                        policy: policy,
                        extraArgs: policy.extraArgs,
                    };
                    const result = await verifyFn(fnArgs);
                    outputActual = result.output;
                    policyDataLinkVals = result.policyDataLinkVals;
                    if (policyDataLinkVals) {
                        policyDataLinksToUpdate.push({
                            policy: policy,
                            link: link,
                            dataVals: policyDataLinkVals,
                        });
                    }
                } catch (err) {
                    error = err.toString();
                }
                // do not make an explicit decision if verifyFn produced an error
                const success = error ? null : JSON.stringify(outputActual) === JSON.stringify(outputExpected);
                const timestamp = Date.now();
                const expires = timestamp + (policy.duration * 1000);
                const verification = {
                    timestamp: new Date(timestamp).toISOString(),
                    expires: new Date(expires).toISOString(),
                    policyId: policyID,
                    linkId: linkID,
                    originSource: domain,
                    originTarget: new URL(link.urlTarget).hostname,
                    urlSource: link.urlSource,
                    urlTarget: link.urlTarget,
                    outputExpected: outputExpected,
                    outputActual: outputActual,
                    success: success,
                    error: error,
                };
                utils.initKeyVal(status, linkID, {
                    status: true,
                    verifications: [],
                });
                status[linkID].verifications.push(verification);
                status[linkID].status = status[linkID].status && success;
                // {
                //     linkID: {
                //         "status": status,
                //         "verifications": verifications
                //     }
                // }
            }

            // flip policy "refresh" value if needed
            if (policy.extraArgs.refresh) {
                policy.extraArgs.refresh = false;
                await dbi.updatePolicyExtraArgs(policy);
            }
        }
        return {
            status: status,
            policyDataLinksToUpdate: policyDataLinksToUpdate,
        };
    }
}


module.exports = {
    VerifierSimple: VerifierSimple,
};