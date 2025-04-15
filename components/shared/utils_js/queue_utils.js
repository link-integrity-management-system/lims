import Queue from 'bee-queue';

import { promisify } from "util";

import config from "/home/ubuntu/app/configs/config.js";
import dbi from "/home/ubuntu/app/shared/database_js/dbiface.js";
import utils from "/home/ubuntu/app/shared/utils_js/utils.js";

async function waitForQueueReady(queue) {
    try {
        await queue.ready();
        const checkHealth = await queue.checkHealth();
        console.log(
            `queue health: ${queue.name} ${JSON.stringify(checkHealth)}`
        );
    } catch (err) {
        console.log(`queue unreadyable: ${queue.name} ${err}`);
    }
}

async function queueCheckStalledJobs(queue) {
    queue.checkStalledJobs(5000);
}

function logJobResult(opts) {
    const { job, jobId, jobType, succeeded, err } = opts;
    const currentTime = new Date();
    const currentTimeISO = currentTime.toISOString();
    const logModifier = succeeded ? "succeeded" : "FAILED";
    const error = succeeded ? "" : err;
    if (job) {
        const delta = (currentTime - new Date(job.data.queueTime)) / 1000;
        console.log(
            `${jobType} job ${logModifier}: ${currentTimeISO} ${jobId} ${job.data.domain} ${delta}s ${error}`
        );
    } else {
        console.log(
            `${jobType} job ${logModifier}: ${currentTimeISO} ${jobId} ${error}`
        );
    }
}

async function setupQueues(queues) {
    const queueReadyPromises = Object.values(queues).map((q) =>
        waitForQueueReady(q)
    );
    await Promise.all([...queueReadyPromises, dbi.setupIndexes()]);
    for (const [type, queue] of Object.entries(queues)) {
        const getJob = promisify(queue.getJob.bind(queue));
        queue.on("job succeeded", async (jobId, result) => {
            let job = await getJob(jobId);
            logJobResult({
                job: job,
                jobId: jobId,
                jobType: type,
                succeeded: true,
                err: undefined,
            });
            // switch (type) {
            //     case WORKER_TYPES.VERIFIER:
            //         break;
            // }
            job = null; // remove reference
            result = null; // remove reference
        });
        queue.on("job failed", async (jobId, err) => {
            let job = await getJob(jobId);
            logJobResult({
                job: job,
                jobId: jobId,
                jobType: type,
                succeeded: false,
                err: err,
            });
            // switch (type) {
            //     case WORKER_TYPES.VERIFIER:
            //         break;
            // }
            job = null; // remove reference
        });
        queue.on("error", (err) => {
            console.log(`${type} queue error: ${err.message}`);
        });
        queue.on("retrying", (job, err) => {
            console.log(
                `${type} job retrying: ${job.id} ${JSON.stringify(job.data)} ${err.message
                }!`
            );
        });
        queue.on("stalled", (jobId) => {
            console.log(
                `${type} job stalled and will be reprocessed: ${jobId}`
            );
        });
    }
}

async function enqueueVerifyJob(domain, page, urlTarget, opts) {
    const delay = opts ? opts.delay : undefined;
    const timeout = opts ? opts.timeout : undefined;
    // if (config.lms.mode === config.lms.modes.noop) {
    //     console.debug(`  queue_utils.enqueueVerifyJob: noop ${domain} ${page} ${urlTarget}`);
    //     return true;
    // }
    const verifyQueue = new Queue(config.queues.verify, config.queues.options.mgr);
    const evalTimeoutForDomain = (page == null && urlTarget == null) ?
        config.intervals.eval_job_timeout :
        config.verifier.simple.timeout;
    const actualTimeout = timeout ?
        timeout :
        evalTimeoutForDomain;
    const job = verifyQueue
        .createJob({
            domain: domain,
            page: page,
            urlTarget: urlTarget,
            queueTime: new Date().toISOString(), // logging
        })
        .timeout(actualTimeout)
        .retries(config.queues.retry_count);
    if (delay && delay > 0) {
        await utils.sleep(delay);
    }
    await job.save();
    console.debug(
        `queue_utils.enqueueVerifyJob: ${job.id} ${JSON.stringify(job.data.queueTime)}`
    );
    // close the Redis connection
    await verifyQueue.close();
    return job;
}

export default {
    waitForQueueReady,
    queueCheckStalledJobs,
    setupQueues,
    enqueueVerifyJob
}