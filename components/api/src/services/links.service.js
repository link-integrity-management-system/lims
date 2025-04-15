const config = require("/home/ubuntu/app/configs/config");
const dbi = require("/home/ubuntu/app/shared/database_js/dbiface");
const queue_utils = require("/home/ubuntu/app/shared/utils_js/queue_utils");

// TODO: verify safe to remove
// function createDomainURLs(domain, page) {
//     return {
//         [domain]: [page],
//     };
// }

async function get_statuses(req, res) {
    // if (config.lms.mode === config.lms.modes.normal) {
    //     dbi.setupIndexes(); // don't need db in noop mode
    // }

    // TODO: verify safe to remove
    // const domainURLs = createDomainURLs(domain, decodedPage);

    const { domain, page } = req.query;
    const decodedPage = Buffer.from(page, "base64").toString();
    try {
        dbi.createDomainURLs(domainURLs, undefined);
        let statuses = {};
        if (config.lms.mode === config.lms.modes.normal) {
            statuses = await dbi.getLinkStatuses(domain, decodedPage);
            const unverified = Object.entries(statuses)
                .filter((x) => x[1] == null)
                .map((x) => x[0]);
            unverified.forEach((urlTarget) =>
                queue_utils.enqueueVerifyJob(domain, decodedPage, urlTarget)
            );
        }
        return res.status(200).send({ success: true, statuses: statuses });
    } catch (err) {
        console.error(err);
        return res.status(400).json({ error: err });
    }
}

async function get_statuses_ws(msg) {
    // if (config.lms.mode === config.lms.modes.normal) {
    //     dbi.setupIndexes(); // don't need db in noop mode
    // }
    // TODO: verify safe to remove
    // const domainURLs = createDomainURLs(domain, page);

    const { domain, page } = msg;
    try {
        // dbi.createDomainURLs(domainURLs, undefined);
        const statuses = await dbi.getLinkStatuses(domain, page);
        const unverified = Object.entries(statuses)
            .filter((x) => x[1] == null)
            .map((x) => x[0]);
        unverified.forEach((urlTarget) =>
            queue_utils.enqueueVerifyJob(domain, page, urlTarget)
        );
        return { success: true, statuses: statuses };
    } catch (err) {
        return { error: err };
    }
}

async function enqueueVerifyJobIfNotVerified(linkId, domain, page, url) {
    const status = await dbi.getVerificationsByLinkId([linkId]);
    const delay = 5000;
    if (status === null) {
        queue_utils.enqueueVerifyJob(domain, page, url, delay);
    }
}

async function get_status_helper(mode, domain, page, url) {
    if (mode == config.lms.modes.noop) {
        return true;
    }

    // TODO: verify safe to remove
    // const domainURLs = createDomainURLs(domain, page);
    // dbi.createDomainURLs(domainURLs, undefined);

    // create link doc
    // - this describes the context where the link was encountered
    const decodedPage = Buffer.from(page, "base64").toString();
    const decodedUrl = Buffer.from(url, "base64").toString();
    const link = {
        originSource: domain,
        urlSource: decodedPage,
        originTarget: new URL(decodedUrl).hostname,
        urlTarget: decodedUrl,
        fromClient: true,
    };
    const linkId = dbi._getLinkIdentifier(link);
    dbi.createLink(link);   // purposefully do not await here
    console.log(link);
    if (mode == config.lms.modes.discovery) {
        // bootstrap verification decision
        enqueueVerifyJobIfNotVerified(linkId, domain, decodedPage, decodedUrl);
        return true;
    }

    // NOTE: the correct thing to do in this case is return status from db.
    // If status is null, enqueue the verify job, and wait for the result.
    // However, we are performing a performance evaluation, so we can
    // always return true since we already performed the database read.
    let status = await dbi.getVerificationsByLinkId([linkId]);
    status = true;    // TODO: REMOVE THIS LINE IN PRODUCTION
    // TODO: UNCOMMENT THE BELOW BLOCK IN PRODUCTION
    // if (status === null) {
    //     queue_utils.enqueueVerifyJob(domain, decodedPage, decodedUrl);
    //     status = await dbi.waitForVerification(linkId);
    // }

    return status;
}

async function get_status(req, res) {
    const { mode, domain, page, url } = req.query;
    let status = true;
    try {
        status = await get_status_helper(mode, domain, page, url);
        return res.status(200).json({
            status: status,
        });
    } catch (err) {
        console.error(err);
        return res.status(400).json({ error: err });
    }
}

async function get_status_ws(msg) {
    const { mode, domain, page, url } = msg;
    let status = true;
    try {
        status = await get_status_helper(mode, domain, page, url);
        return { status: status };
    } catch (err) {
        return { error: err };
    }
}

async function post_dns_resolutions(req, res) {
    const domains = Object.keys(req.body.data.dns);
    // const problems = await dbi.check_dns_resolutions(req.body.data.dns);
    return res.status(200).json({
        domains: domains,
    });
}

async function post_dns_resolutions_ws(msg) {
    const domains = Object.keys(msg);
    return { domains: domains };
}

function routeWSMessage(route) {
    if (route.indexOf("/links/statuses") > -1) {
        return get_statuses_ws;
    } else if (route.indexOf("/links/status") > -1) {
        return get_status_ws;
    } else if (route.indexOf("/links/resolutions") > -1) {
        return post_dns_resolutions_ws;
    }
}

module.exports = {
    get_statuses: get_statuses,
    get_statuses_ws: get_statuses_ws,
    get_status: get_status,
    get_status_ws: get_status_ws,
    post_dns_resolutions: post_dns_resolutions,
    post_dns_resolutions_ws: post_dns_resolutions_ws,
    routeWSMessage: routeWSMessage,
};
