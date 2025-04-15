const fs = require('fs').promises;

const Queue = require("bee-queue");

const config = require("/home/ubuntu/app/configs/config");
const dbi = require("/home/ubuntu/app/shared/database_js/dbiface");
const queue_utils = require('/home/ubuntu/app/shared/utils_js/queue_utils');

const DOMAINS_FILE = "./sample-domains.csv"

async function readDomains() {
    try {
        const data = await fs.readFile(DOMAINS_FILE, 'utf-8');
        const domains = data.split("\n").map((x) => {
            return x.split(",")[1];
        });
        return domains.filter(x => x && x.trim().length > 0);
    } catch (error) {
        console.error(`Error reading file from path ${path}:`, error);
        throw error;
    }
}

async function main() {
    const domains = await readDomains();
    console.debug(`read ${domains.length} domains...`)
    for (const [idx, domain] of domains.entries()) {
        console.debug(`idx=${idx} domain=${domain}`);
        const failedCreate = await dbi.createDefaultPolicies(domain);
        if (Object.keys(failedCreate).length > 0) {
            console.debug(`  failedCreate=${JSON.stringify(failedCreate)}`);
        }
        // break;
    }
}

async function schedulePolicies() {
    const domains = await dbi.getDomainsWithPolicies();
    for (const [idx, domain] of domains.entries()) {
        console.debug(`idx=${idx} domain=${domain}`);
        await queue_utils.enqueueVerifyJob(domain, null, null, {});
        // break;
    }
}

async function enqueueVerifyJobIfNotVerified(linkId, domain, page, url) {
    const status = await dbi.getVerificationsByLinkId([linkId]);
    if (status[linkId] === null) {
        console.debug(`  enqueueVerifyJob... domain=${domain} linkId=${linkId}`);
        queue_utils.enqueueVerifyJob(
            domain,
            page,
            url,
        );
    }
}

async function clearQueue() {
    const verifyQueue = new Queue(config.queues.verify, config.queues.options.mgr);
    await verifyQueue.destroy();
    await verifyQueue.close();
}

async function scheduleLinkVerifications() {
    const domains = await dbi.getDomainsWithPolicies();
    const numDomains = domains.length;
    // const domainLinks = {};
    for (const [idx, domain] of domains.entries()) {
        const { links } = await dbi.getPolicyLinks(domain, null, null);
        // const linkIDs = [];
        const linkInfo = {};
        // domainLinks[domain] = {};
        // console.debug(`idx=${idx} domain=${domain}`);
        for (const [policyId, doc] of Object.entries(links)) {
            for (const [linkId, link] of Object.entries(doc)) {
                // domainLinks[domain][linkId] = link;
                // linkIDs.push(linkId);
                linkInfo[linkId] = link;
            }
        }

        const statuses = await dbi.getVerificationsByLinkId(Object.keys(linkInfo));
        const filteredEntries = Object.fromEntries(
            Object.entries(statuses)
                .filter(([key, value]) => value !== true)
        );
        const filteredLinkIDs = Object.keys(filteredEntries);
        if (filteredLinkIDs.length == 0) {
            continue;
        }
        console.debug(`idx=${idx}/${numDomains} domain=${domain} found ${filteredLinkIDs.length} links to schedule...`);

        for (const linkId of filteredLinkIDs) {
            const link = linkInfo[linkId];
            // console.debug(`  idx=${idx}/${filteredLinkIDs.length} domain=${domain} linkId=${linkId}`);
            await queue_utils.enqueueVerifyJob(
                domain,
                link.urlSource,
                link.urlTarget,
            );
        }

        // break;
    }
}

(async () => {
    try {
        await dbi.setupIndexes();
        // await main();
        // await schedulePolicies();
        // await clearQueue();
        // await scheduleLinkVerifications();
    } catch (err) {
        console.error(err);
    }
})();
