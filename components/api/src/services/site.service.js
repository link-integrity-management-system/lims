const Queue = require("bee-queue");

const config = require("/home/ubuntu/app/configs/config");
const dbi = require("/home/ubuntu/app/shared/database_js/dbiface");

const crawlQueue = new Queue(config.queues.crawl, config.queues.options.mgr);
const verifyQueue = new Queue(config.queues.verify, config.queues.options.mgr);

const enqueueCrawlJob = async (domain) => {
    const job = crawlQueue
        .createJob({
            domain: domain,
            queueTime: new Date().toISOString(), // logging
            persistCache: false,
            maxDepth: 1,
            obeyRobotsTxt: false,
            timeout: config.page_timeout,
            // retryCount: config.collector.retry_count,
            extraHeaders: config.extra_headers,
            userAgent: config.user_agent,
            puppeteerArgs: config.puppeteer_args,
        })
        .timeout(config.intervals.job_timeout)
        .retries(config.queues.retry_count);
    await job.save();
    console.debug(
        `Crawl job enqueued: ${job.data.queueTime} ${job.id} ${job.data.domain}`
    );
    return job;
};

const enqueueVerifyJob = async (domain) => {
    const job = verifyQueue
        .createJob({
            domain: domain,
            queueTime: new Date().toISOString(), // logging
        })
        .timeout(config.intervals.job_timeout)
        .retries(config.queues.retry_count);
    await job.save();
    console.debug(
        `Verify job enqueued: ${job.data.queueTime} ${job.id} ${job.data.domain}`
    );
    return job;
};

async function post_register(req, res) {
    const domainURLs = req.body.domainURLs;
    const useHeaders = req.body.useHeaders ? req.body.useHeaders : true;
    try {
        const failedIDs = await dbi.createDomainURLs(
            domainURLs,
            useHeaders
        );
        console.warn(
            `  /site/register: failed ${JSON.stringify(failedIDs)}`
        );
        return res.status(200).send({ success: true });
    } catch (err) {
        console.error(err);
        return res.status(400).json({ error: err });
    }
}

async function post_crawl(req, res) {
    const domain = req.body.domain;
    try {
        const job = await enqueueCrawlJob(domain);
        return res.status(200).send(req.body);
    } catch (err) {
        console.error(err);
        return res.status(400).json({ error: err });
    }
}

async function post_verify(req, res) {
    const domain = req.body.domain;
    try {
        const job = await enqueueVerifyJob(domain);
        return res.status(200).send(req.body);
    } catch (err) {
        console.error(err);
        return res.status(400).json({ error: err });
    }
}

module.exports = {
    post_register: post_register,
    post_crawl: post_crawl,
    post_verify: post_verify,
};
