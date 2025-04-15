import fs from "fs";

import { Client } from "@elastic/elasticsearch";

import config from "/home/ubuntu/app/configs/config.js";
import utils from "/home/ubuntu/app/shared/utils_js/utils.js";
import models from "/home/ubuntu/app/shared/database_js/models.js";
import es_settings from "/home/ubuntu/app/shared/database_js/elastic_settings.js";

const { INGEST_PIPELINES, INDICES } = es_settings;

import * as date_fns from "date-fns";

const ES = new Client({
    nodes: config.elastic.nodes,
    auth: {
        username: "elastic",
        password: fs.readFileSync("/run/secrets/elastic_password", "utf-8").trim(),
    },
    // caFingerprint: config.elastic.ca_fingerprint,
    tls: {
        ca: fs.readFileSync(`${config.elastic.certs_dir}/ca/ca.crt`),
        rejectUnauthorized: false,
    },
    requestTimeout: config.elastic.timeout_ms,
});

/* ---------------- SETUP & HELPERS ---------------- */

async function putIngestPipelines() {
    for (const pipeline of INGEST_PIPELINES) {
        await ES.ingest.putPipeline({
            id: pipeline.name,
            body: pipeline.settings,
        });
    }
}

async function createIndexIfNotExists(name, settings, mappings) {
    const exists = await ES.indices.exists({
        index: name,
    });
    if (!exists) {
        try {
            await ES.indices.create({
                index: name,
                body: {
                    settings: settings,
                    mappings: mappings,
                },
            });
        } catch (err) {
            // most likely another worker created the index in the meantime
            console.error(`failed to create index: ${name}, err`, err);
        }
    }
}

function getDailyIndex(indexSettings, _date) {
    const date = _date ? _date : utils.getCurrentDate();
    const index = `${indexSettings.name}-${date}`;
    return index;
}

function getIndex(indexSettings) {
    if (indexSettings.rotating) {
        return getDailyIndex(indexSettings, null);
    } else {
        return indexSettings.name;
    }
}

async function createDailyIndex(indexSettings, date) {
    const index = getDailyIndex(indexSettings, date);
    await createIndexIfNotExists(
        index,
        indexSettings.settings,
        indexSettings.mappings
    );
    return index;
}

async function setupIndexes() {
    await putIngestPipelines();
    for (const [_, index] of Object.entries(INDICES)) {
        if (index.rotating) {
            await createDailyIndex(index);
            continue;
        }
        await createIndexIfNotExists(
            index.name,
            index.settings,
            index.mappings
        );
    }
}

// async function mgetWrapper(opts) {
//     // docs: [{ _index: index, _id: id }]
//     //      can specify index in the doc if desired
//     const { index, docs } = opts;
//     const resp = await ES.mget({
//         index: index,
//         body: {
//             docs: docs,
//         },
//     });
//     console.debug(`resp=${resp}`);
// }

async function bulkWrapper(opts) {
    const { docs, onDocument, onDropID, docType } = opts;
    const refreshOnCompletion = opts.refreshOnCompletion !== undefined ?
        opts.refreshOnCompletion :
        false;
    const throwOnErr = opts.throwOnErr !== undefined ? opts.throwOnErr : false;
    const docIDErrors = {};
    const resp = await ES.helpers.bulk({
        datasource: docs,
        onDocument: onDocument,
        onDrop(doc) {
            const document = doc.document;
            const id = onDropID(document);
            const err = doc.error;
            docIDErrors[id] = err;
            console.error(
                `  dbiface: bulkWrapper failed ${docType}: ${id} ${JSON.stringify(
                    err
                )}`
            );
        },
        refreshOnCompletion: refreshOnCompletion
    });
    const numFailed = Object.keys(docIDErrors).length;
    const msg = ` failed ${Object.keys(docIDErrors).length} operations`;
    if (throwOnErr && numFailed > 0) {
        throw new Error(msg);
    }
    return docIDErrors;
}


/* ---------------- DOMAIN URLS ---------------- */

async function getDomainsWithPolicies() {
    const resp = await ES.search({
        index: getIndex(INDICES.POLICIES),
        body: {
            size: 0,
            aggs: {
                unique_values: {
                    terms: {
                        field: "originSource",
                        size: 1000,
                    }
                }
            }
        }
    });
    return resp.aggregations.unique_values.buckets.map((x) => x.key);
}

// async function getLatestPageCrawlTime(pageID) {
//     const resp = await ES.get({
//         id: pageID,
//         index: INDICES.DOMAIN_URLS.name,
//     });
//     const latestCrawl = resp._source.latestCrawl / 1000;
//     return utils.getUTCDateSeconds(latestCrawl);
// }

// async function updatePageCrawlTimes(pageData) {
//     const docs = [];
//     for (const [_, data] of Object.entries(pageData)) {
//         docs.push({ pageID: data.pageElasticID });
//     }
//     const opts = {
//         docs: docs,
//         onDocument(doc) {
//             return [
//                 {
//                     update: {
//                         _id: doc.pageID,
//                         _index: INDICES.DOMAIN_URLS.name,
//                         retry_on_conflict: 3,
//                     },
//                 },
//                 {
//                     script: {
//                         source: "ctx._source.latestCrawl = ctx._now;",
//                         lang: "painless",
//                     },
//                     doc: undefined, // https://github.com/elastic/elasticsearch-js/issues/1244
//                 },
//             ];
//         },
//         onDropID: _getDomainURLIdentifier,
//         docType: "update-domain-url",
//         throwOnErr: false,
//     };
//     const failedIDs = await bulkWrapper(opts);
//     const numSuccess = docs.length - Object.keys(failedIDs).length;
//     const numTotal = docs.length;
//     console.debug(
//         `    dbi: updatePageCrawlTimes updated ${numSuccess}/${numTotal}`
//     );
//     return failedIDs;
// }

// async function getDomainCrawlOpts(domain) {
//     const search = await ES.search({
//         index: INDICES.DOMAIN_URLS.name,
//         size: 1, // crawl opts are same for all pages of the domain
//         body: {
//             query: {
//                 term: {
//                     domain: {
//                         value: domain,
//                     },
//                 },
//             },
//         },
//     });
//     const opts = {};
//     for (const hit of search.hits.hits) {
//         const { headers } = hit._source;
//         opts.headers = headers;
//     }
//     if (Object.keys(opts).length == 0) {
//         throw new Error(`Unable to get crawl opts for domain ${domain}`);
//     }
//     return opts;
// }

// async function getDomainURLs(domain) {
//     const should = {
//         term: {
//             domain: {
//                 value: domain,
//             },
//         },
//     };
//     const scrollSearch = ES.helpers.scrollSearch({
//         index: INDICES.DOMAIN_URLS.name,
//         body: {
//             query: {
//                 bool: {
//                     should: should,
//                     minimum_should_match: 1,
//                 },
//             },
//         },
//         size: 1024,
//         _source: ["domain", "url"],
//         scroll: "30s",
//     });
//     const urls = [];
//     for await (const result of scrollSearch) {
//         for (const doc of result.body.hits.hits) {
//             const { domain, url } = doc._source;
//             urls.push({
//                 url: url,
//                 id: doc._id,
//             });
//         }
//     }
//     return urls;
// }

// async function createDomainURLs(domainURLs, headers) {
//     const useHeaders =
//         headers === undefined || headers === null ? true : headers;
//     const docs = Object.entries(domainURLs).flatMap((x) =>
//         x[1].map((url) => {
//             return {
//                 domain: x[0],
//                 url: url,
//                 headers: useHeaders,
//                 latestCrawl: 0,
//             };
//         })
//     );
//     const opts = {
//         docs: docs,
//         onDocument(doc) {
//             const identifier = _getDomainURLIdentifier(doc);
//             return {
//                 index: {
//                     // replacing is OK
//                     _index: INDICES.DOMAIN_URLS.name,
//                     _id: utils.hash(identifier),
//                 },
//             };
//         },
//         onDropID: _getDomainURLIdentifier,
//         docType: "domain-url",
//         throwOnErr: false,
//     };
//     const failedIDs = await bulkWrapper(opts);
//     const numCreated = docs.length - Object.keys(failedIDs).length;
//     const numTotal = docs.length;
//     console.debug(
//         `    dbi: createDomainURLs created ${numCreated}/${numTotal} URLs`
//     );
//     return failedIDs;
// }

/* ---------------- POLICIES ---------------- */

async function getPolicies(domain) {
    const index = INDICES.POLICIES.name;
    const scrollSearch = ES.helpers.scrollSearch({
        index: index,
        body: {
            query: {
                wildcard: {
                    originSource: {
                        value: `*${domain}`,
                    },
                },
            },
        },
        size: 1024,
        scroll: "30s",
    });
    const policies = {};
    for await (const result of scrollSearch) {
        for (const doc of result.body.hits.hits) {
            const policy = new models.IntegrityPolicy(doc._source);
            policies[doc._id] = policy;
        }
    }
    return policies;
}

async function createPolicies(policies) {
    const docs = policies;
    const opts = {
        docs: docs,
        onDocument(doc) {
            const identifier = _getPolicyIdentifier(doc);
            return {
                // replace if necessary
                index: {
                    _index: INDICES.POLICIES.name,
                    _id: identifier,
                },
            };
        },
        onDropID: _getPolicyIdentifier,
        docType: "link",
        throwOnErr: false,
    };
    const failedIDs = await bulkWrapper(opts);
    const numCreated = docs.length - Object.keys(failedIDs).length;
    const numTotal = docs.length;
    console.debug(
        `    dbi: createPolicies created ${numCreated}/${numTotal} policies`
    );
    return failedIDs;
}

async function getPolicyDataLinkVals(policy, link) {
    const index = INDICES.POLICY_DATA.name;
    const id = _getPolicyDataLinkIdentifier(policy, link);

    try {
        const resp = await ES.get({
            id: id,
            index: index,
        });
        return resp._source.vals;
    } catch (err) {
        // does not exist
    }
    return {};
}

async function updatePolicyExtraArgs(policy) {
    let success = true;
    try {
        const response = await ES.update({
            index: INDICES.POLICIES.name,
            id: _getPolicyIdentifier(policy),
            body: {
                doc: {
                    extraArgs: policy.extraArgs,
                }
            }
        });
        console.debug(`    dbi: updatePolicy updated ${JSON.stringify(response)}`);
    } catch (error) {
        console.error(`    dbi: updatePolicy errored ${error}`);
        success = false;
    }
    return success;
}

// async function updatePolicyDataLinkVals(policy, link, vals) {
//     const id = _getPolicyDataLinkIdentifier(policy, link);
//     let success = true;
//     try {
//         const response = await ES.update({
//           index: INDICES.POLICY_DATA.name,
//           id: id,
//           body: {
//             doc: {
//                 vals: vals,
//             },
//             upsert: {
//                 vals: vals,
//             },
//           }
//         });
//         console.debug(`    dbi: updatePolicyDataLinkVals updated ${JSON.stringify(response)}`);
//     } catch (error) {
//         console.error(`    dbi: updatePolicyDataLinkVals errored ${error}`);
//         success = false;
//     }
//     return success;
// }

async function updatePolicyDataLinkVals(policyDataLinkVals) {
    const index = getIndex(INDICES.POLICY_DATA);
    const docs = [];
    for (const { policy, link, dataVals } of policyDataLinkVals) {
        docs.push({
            policyId: _getPolicyIdentifier(policy),
            linkId: _getLinkIdentifier(link),
            vals: dataVals,
        });
    }
    const opts = {
        docs: docs,
        onDocument(doc) {
            const _id = _getPolicyDataLinkIdentiferFromIds(
                doc.policyId,
                doc.linkId,
            );
            return [
                { update: { _index: index, _id: _id } },
                { doc_as_upsert: true },
            ];
        },
        onDropID: (x) => _getPolicyDataLinkIdentiferFromIds(x.policyId, x.linkId),
        docType: "policyDataLinkVals",
        throwOnErr: false,
        refreshOnCompletion: true,
    };
    const failedIDs = await bulkWrapper(opts);
    const numCreated = docs.length - Object.keys(failedIDs).length;
    const numTotal = docs.length;
    console.debug(
        `    dbi: updatePolicyDataLinkVals completed ${numCreated}/${numTotal} ops`
    );
    return failedIDs;

}

function getDefaultPolicies(domain) {
    const policyDurationDays = 45;
    const verificationDurationDays = 45;
    const defaultPolicyBlocks = [
        {
            name: "recently_registered",
            type: "location",
            extraArgs: { threshold: 7 },
            expectedOutput: false,
        },
        {
            name: "domain_dropping",
            type: "location",
            extraArgs: { threshold: 7 },
            expectedOutput: false,
        },
        {
            name: "domain_rank",
            type: "location",
            extraArgs: { threshold: 1_000_000 },
            expectedOutput: false,
        },
        {
            name: "changed_dependencies",
            type: "location",
            extraArgs: { refresh: true, allowed: [] },
            expectedOutput: false,
        },
        {
            name: "comms_tls",
            type: "location",
            extraArgs: {},
            expectedOutput: true,
        },
    ];
    const policies = defaultPolicyBlocks.map(x => ({
        name: `${domain} default-${x.name}`,
        strategy: "simple",
        type: x.type,
        originSource: domain,
        originTarget: ".*",
        urlSource: `.*`,
        urlTarget: ".*",
        created: new Date(),
        expired: date_fns.addDays(new Date(), policyDurationDays),
        description: `${domain} default-${x.name}`,
        verifyFn: x.name,
        verifyFnOutput: x.expectedOutput,
        duration: 86400 * verificationDurationDays,
        extraArgs: x.extraArgs,
    }));
    return policies;
}

async function createDefaultPolicies(domain) {
    const policies = getDefaultPolicies(domain);
    const failedCreatePolicies = await createPolicies(policies);
    return failedCreatePolicies;
}

/* ---------------- LINKS & VERIFS. ---------------- */

async function getLinks(domain, page) {
    const should = [];
    if (domain) {
        should.push({
            wildcard: {
                originSource: {
                    value: `*${domain}`,
                },
            },
        });
    }
    if (page) {
        should.push({
            term: {
                urlSource: {
                    value: page,
                },
            },
        });
    }
    const index = getIndex(INDICES.LINKS);
    const scrollSearch = ES.helpers.scrollSearch({
        index: index,
        body: {
            query: {
                bool: {
                    should: should,
                },
            },
        },
        size: 1024,
        scroll: "30s",
    });
    const links = [];
    for await (const result of scrollSearch) {
        for (const doc of result.body.hits.hits) {
            links.push(doc._source);
        }
    }
    return links;
}

async function getPolicyLinks(domain, page, urlTarget) {
    const etld1 = utils.getETLDPlus1(domain);
    const policies = await getPolicies(etld1);
    const indexLinks = getIndex(INDICES.LINKS);
    const must = [];
    if (etld1) {
        must.push({
            wildcard: {
                "originSource": {
                    value: `*${etld1}`,
                },
            },
        });
    }
    if (page) {
        must.push({
            term: {
                "urlSource.keyword": {
                    value: page,
                },
            },
        });
    }
    if (urlTarget) {
        must.push({
            term: {
                "urlTarget.keyword": {
                    value: urlTarget,
                },
            },
        });
    }
    const scrollSearch = ES.helpers.scrollSearch({
        index: indexLinks,
        body: {
            query: {
                bool: {
                    must: must,
                },
            },
        },
        size: 1024,
        scroll: "30s",
    });
    let numLinks = 0;
    let numTotalLinks = 0;
    const links = {};

    for await (const result of scrollSearch) {
        for (const doc of result.body.hits.hits) {
            const linkUrlTarget = doc._source.urlTarget;
            const linkUrlSource = doc._source.urlSource;
            for (const [policyID, policy] of Object.entries(policies)) {
                const policyUrlTargetPtrn = policy.urlTarget;
                const policyUrlSourcePtrn = policy.urlSource;
                const matchesTarget = utils.urlMatches(
                    policyUrlTargetPtrn,
                    linkUrlTarget
                );
                const matchesSource = utils.urlMatches(
                    policyUrlSourcePtrn,
                    linkUrlSource
                );
                if (matchesTarget && matchesSource) {
                    utils.initKeyVal(links, policyID, {});
                    links[policyID][doc._id] = doc._source;
                    numLinks += 1;
                }
                numTotalLinks += 1;
            }
        }
    }
    console.debug(
        `  dbi: getPolicyLinks found ${numLinks}/${numTotalLinks} links for ${Object.keys(policies).length
        } policies for ${domain} ${page} ${urlTarget}`
    );
    return {
        policies: policies,
        links: links,
    };
}

function _getLinkIdentifier(doc) {
    return utils.hash(`${doc.urlSource} ${doc.urlTarget}`);
}

function _getVerificationIdentifier(doc) {
    return utils.hash(`${doc.policyId} ${doc.urlSource} ${doc.urlTarget}`);
}

function _getDomainURLIdentifier(doc) {
    return utils.hash(`${doc.domain}/${doc.url}`);
}

function _getPolicyIdentifier(doc) {
    // unique policy name
    return utils.hash(`${doc.name}`);
    // return `${doc.originSource} ${doc.originTarget} ${doc.type} ${doc.description}`;
}

function _getPolicyDataLinkIdentifier(policy, link) {
    const policyId = _getPolicyIdentifier(policy);
    const linkId = _getLinkIdentifier(link);

    // hashing a concatenation of two hashes lol
    return _getPolicyDataLinkIdentiferFromIds(policyId, linkId);
}

function _getPolicyDataLinkIdentiferFromIds(policyId, linkId) {
    // hashing a concatenation of two hashes lol
    return utils.hash(`${policyId} ${linkId}`);
}

function _getCrawlIdentifier(doc) {
    return utils.hash(`${doc.domain}`);
}

function _getRequestsIdentifier(doc) {
    return utils.hash(`${doc.domain}/${doc.requestID}`);
}

async function createLink(link) {
    const doc = link;
    const index = getIndex(INDICES.LINKS);
    // const index = await createDailyIndex(INDICES.LINKS, null);
    const identifier = _getLinkIdentifier(doc);
    await ES.index({
        index: index,
        id: identifier,
        document: doc,
    });
    return identifier;
}

async function createLinks(links) {
    const docs = links;
    const index = await createDailyIndex(INDICES.LINKS, null);
    const opts = {
        docs: docs,
        onDocument(doc) {
            const identifier = _getLinkIdentifier(doc);
            return {
                // do not replace if possible
                create: {
                    _index: index,
                    _id: identifier,
                },
            };
        },
        onDropID: _getLinkIdentifier,
        docType: "link",
        throwOnErr: false,
    };
    const failedIDs = await bulkWrapper(opts);
    const numCreated = docs.length - Object.keys(failedIDs).length;
    const numTotal = docs.length;
    console.debug(
        `    dbi: createLinks created ${numCreated}/${numTotal} URLs`
    );
    return failedIDs;
}

async function indexVerifications(verifications) {
    const docs = verifications;
    const index = getIndex(INDICES.VERIFICATIONS);
    let failedIDs = 0;
    if (docs.length > 0) {
        const opts = {
            docs: verifications,
            onDocument(doc) {
                return {
                    // use random ID
                    index: {
                        _index: index,
                    },
                };
            },
            onDropID: _getVerificationIdentifier, // just for debugging
            docType: "verification",
            throwOnErr: true,
        };
        failedIDs = await bulkWrapper(opts);
    }
    const numCreated = docs.length - Object.keys(failedIDs).length;
    const numTotal = docs.length;
    console.debug(
        `    dbi: indexVerifications created ${numCreated}/${numTotal} verifications`
    );
    return failedIDs;
}

async function getMissingVerifications(domain) {
    const policyLinks = await getPolicyLinks(domain, null, null);
    const linkIDs = [];
    for (const [policyID, linkInfo] of Object.entries(policyLinks["links"])) {
        for (const [linkID, link] of Object.entries(linkInfo)) {
            // console.debug(`policyID=${policyID}, linkID=${linkID}, link=${JSON.stringify(link)}`);
            linkIDs.push(linkID);
        }
    }
    const verifications = await getVerificationsByLinkId(linkIDs);
    const filtered = Object.fromEntries(
        Object.entries(verifications).filter(([key, val]) => val != true)
    );
    return filtered;
}

async function getVerificationsByLinkId(linkIDs) {
    const index = getIndex(INDICES.VERIFICATIONS);
    let statuses = {};
    for (const linkID of linkIDs) {
        statuses[linkID] = null;
    }
    let afterKey = undefined; // To track pagination

    do {
        const response = await ES.search({
            index: index,
            body: {
                size: 0, // We're only interested in aggregations, not raw hits
                query: {
                    bool: {
                        must: [
                            {
                                terms: {
                                    'linkId': linkIDs
                                }
                            },
                            {
                                range: {
                                    expires: {
                                        gt: 'now'
                                    }
                                }
                            }
                        ]
                    }
                },
                aggs: {
                    group_by_link_and_policy: {
                        composite: {
                            sources: [
                                {
                                    linkId: {
                                        terms: {
                                            field: 'linkId'
                                        }
                                    }
                                },
                                {
                                    policyId: {
                                        terms: {
                                            field: 'policyId'
                                        }
                                    }
                                }
                            ],
                            size: 100, // Adjust the page size if needed
                            after: afterKey // Use the `after` key for pagination
                        },
                        aggs: {
                            latest_document: {
                                top_hits: {
                                    sort: [
                                        {
                                            timestamp: {
                                                order: 'desc'
                                            }
                                        }
                                    ],
                                    size: 1 // Return only the latest document for each group
                                }
                            }
                        }
                    }
                }
            }
        });

        const buckets = response.aggregations.group_by_link_and_policy.buckets;
        for (const bucket of buckets) {
            const linkId = bucket.key.linkId;
            // const policyId = bucket.key.policyId;
            const { success } = bucket.latest_document.hits.hits[0]._source;
            statuses[linkId] = statuses[linkId] === null ?
                success :
                statuses[linkId] && success;
        }

        // Check if there's more data (pagination)
        afterKey = response.aggregations.group_by_link_and_policy.after_key || null;

    } while (afterKey); // Continue until no more `after_key`

    return statuses;
}

// async function getVerificationsByLinkId(linkIDs) {
//     const index = getIndex(INDICES.VERIFICATIONS);
//     const search = await ES.search({
//         index: index,
//         size: 1, // crawl opts are same for all pages of the domain
//         body: {
//             query: {
//                 bool: {
//                     must: [
//                         {
//                             terms: {
//                                 linkId: linkIDs,
//                             },
//                         },
//                         {
//                             range: {
//                                 expires: {
//                                     gte: "now",
//                                 },
//                             },
//                         },
//                     ],
//                 },
//             },
//         },
//     });
//     let statuses = {};
//     for (const linkID of linkIDs) {
//         statuses[linkID] = null;
//     }
//     // TODO: perhaps we can order the verifications by their
//     // time descending, and just grab the latest one
//     for (const hit of search.hits.hits) {
//         const { linkId, success } = hit._source;
//         statuses[linkId] = statuses[linkId] === null ? 
//             success : 
//             statuses[linkId] && success;
//     }
//     return statuses;
// }

async function waitForVerification(linkId) {
    if (config.lms.mode === config.lms.modes.noop) {
        console.debug(`  dbi.waitForVerification: noop ${linkId}`);
        return true;
    }
    const id = linkId;
    // add 1 second
    const timeout = config.intervals.job_timeout + 1 * 1000;
    const pollFreq = config.intervals.poll_verify;
    const start = Date.now();
    let result = {};
    let diff = 0;
    while (result[linkId] === null && diff < timeout) {
        result = await getVerificationsByLinkId([id]);
        await utils.sleep(pollFreq);
        diff = Date.now() - start;
    }
    console.debug(`  dbi.waitForVerification: ${linkId} ${result}`);
    return result[linkId];
}

async function getRelevantVerifications(domain, page, link) {
    const should = [
        {
            term: {
                "urlTarget.keyword": {
                    value: link.urlTarget,
                },
            },
        },
    ];
    if (domain) {
        should.push({
            wildcard: {
                originSource: {
                    value: `*${domain}`,
                },
            },
        });
    }
    if (page) {
        should.push({
            term: {
                "urlSource.keyword": {
                    value: page,
                },
            },
        });
    }
    const index = getIndex(INDICES.VERIFICATIONS);
    const scrollSearch = ES.helpers.scrollSearch({
        index: index,
        body: {
            query: {
                bool: {
                    should: should,
                    minimum_should_match: should.length,
                },
            },
        },
        size: 1024,
        scroll: "30s",
    });
    const status = {};
    let numVerifications = 0;
    for await (const result of scrollSearch) {
        for (const doc of result.body.hits.hits) {
            const { success, urlTarget } = doc._source;
            utils.initKeyVal(status, urlTarget, true);
            status[urlTarget] = status[urlTarget] && success;
            numVerifications += 1;
        }
    }
    console.debug(
        `  found ${numVerifications} verifications for link ${link.urlTarget}`
    );
    return status;
}

async function getLinkStatuses(domain, page) {
    const links = await getLinks(domain, page);
    const statuses = {};
    for (const link of links) {
        if (config.lms.mode === config.lms.modes.noop) {
            statuses[link.urlTarget] = true;
            continue;
        }
        statuses[link.urlTarget] = null;
        const linkStatus = await getRelevantVerifications(domain, page, link);
        for (const [key, val] of Object.entries(linkStatus)) {
            statuses[key] = val;
        }
    }
    return statuses;
}

/* ---------------- PUSH ---------------- */

async function* getPushClients(_start, _stop) {
    const start = _start ? _start : 0;
    const stop = _stop ? _stop : -1;
    const index = INDICES.SUBSCRIPTIONS.name;
    const scrollSearch = ES.helpers.scrollDocuments({
        index: index,
        body: {
            query: {
                match_all: {},
            },
        },
        size: 1024,
        scroll: "30s",
    });
    let ctr = 0;
    for await (const doc of scrollSearch) {
        if (start <= ctr && (stop == -1 || ctr < stop)) {
            yield doc;
        }
        ctr += 1;
        if (stop != -1 && ctr >= stop) {
            break;
        }
    }
}

async function registerPushClient(subscription) {
    // const docs = [subscription];
    // const opts = {
    //     docs: docs,
    //     onDocument(doc) {
    //         return {
    //             index: {
    //                 _index: INDICES.SUBSCRIPTIONS.name,
    //                 _id: utils.compress(doc.subscription.endpoint),
    //             },
    //         };
    //     },
    //     onDropID(doc) {
    //         return utils.compress(doc.subscription.endpoint);
    //     },
    //     docType: 'subscription',
    // };
    await ES.index({
        index: INDICES.SUBSCRIPTIONS.name,
        id: utils.compress(subscription.endpoint),
        document: subscription,
    });
}

async function prunePushClients(subscriptions) {
    const opts = {
        docs: subscriptions,
        onDocument(doc) {
            return {
                delete: {
                    _index: INDICES.SUBSCRIPTIONS.name,
                    _id: utils.hash(doc.endpoint),
                },
            };
        },
        onDropID(doc) {
            return doc.endpoint;
        },
        docType: "subscription",
    };
    const failedIDs = await bulkWrapper(opts);
    console.debug(
        `    dbi: prunePushClients pruned ${subscriptions.length} clients`
    );
}

/* ---------------- WRITES ---------------- */

async function createCrawl(crawl) {
    const doc = crawl;
    const index = await createDailyIndex(INDICES.CRAWLS, null);
    const identifier = _getCrawlIdentifier(doc);
    await ES.index({
        index: index,
        id: identifier,
        document: doc,
    });
    return identifier;
}

async function createRequests(data) {
    const {
        domain,
        page,
        pageError,
        requestMetadata,
        requestIdOrder,
        originalRequestUrls,
    } = data;

    const crawlDoc = {
        domain: domain,
        page: page,
        pageError: pageError,
        requestIdOrder: requestIdOrder,
    };
    const reqsDocs = []
    for (const [reqID, reqMetadata] of Object.entries(requestMetadata)) {
        reqMetadata["domain"] = domain;
        reqMetadata["requestID"] = reqID;
        const doc = new models.RequestData(reqMetadata);
        // reqMetadata["reqParams"]["originalUrl"] = originalRequestUrls[reqID];
        reqsDocs.push(doc);
    }

    const opts = {
        docs: reqsDocs,
        onDocument(doc) {
            const identifier = _getRequestsIdentifier(doc);
            return {
                // replace if necessary
                index: {
                    _index: getDailyIndex(INDICES.REQUESTS),
                    _id: identifier,
                },
            };
        },
        onDropID: _getRequestsIdentifier,
        docType: "request",
        throwOnErr: false,
    };
    const results = await Promise.all([
        createCrawl(crawlDoc),
        bulkWrapper(opts),
    ]);
    const crawlID = results[0];
    const failedReqIDs = results[1] || {};
    const numCreated = reqsDocs.length - Object.keys(failedReqIDs).length;
    const numTotal = reqsDocs.length;

    console.debug(`    dbi: createRequests ${domain} crawl ${crawlID} created ${numCreated}/${numTotal}`);
}

async function createSources(sources) { }

export default {
    setupIndexes,
    _getLinkIdentifier,

    // domain urls
    getDomainsWithPolicies,
    // getLatestPageCrawlTime,
    // updatePageCrawlTimes,
    // getDomainCrawlOpts,
    // getDomainURLs,
    // createDomainURLs,

    // policies
    getDefaultPolicies,
    createDefaultPolicies,
    getPolicies,
    createPolicies,
    getPolicyDataLinkVals,
    updatePolicyExtraArgs,
    updatePolicyDataLinkVals,

    // links & verifications
    getPolicyLinks,
    createLink,
    createLinks,
    indexVerifications,
    getMissingVerifications,
    getVerificationsByLinkId,
    waitForVerification,
    getLinkStatuses,

    // request data for policy generation
    createCrawl,
    createRequests,
    createSources,

    // push
    getPushClients,

    registerPushClient,
    prunePushClients,
};
