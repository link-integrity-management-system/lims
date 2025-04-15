import { promisify } from 'util';

import axios from 'axios';
import { chromium } from 'patchright';
import { DateTime } from "luxon";
import Queue from 'bee-queue';
import cloneDeep from 'lodash.clonedeep';


import dbi from "/home/ubuntu/app/shared/database_js/dbiface.js";
import queue_utils from "/home/ubuntu/app/shared/utils_js/queue_utils.js";

const WORKER_TYPES = {
    COLLECTOR: "Collector",
    SCHEDULER: "Scheduler",
}

class Worker {
    constructor(settings, type) {
        this._settings = settings ? settings : {};
        this.type = type;
        this.restart_every_n_min = null; // must be set by subclass
        this.healthcheck_url = null; // must be set by subclass if desired
        this._intervals = {};
    }


    init() {
        this.startTime = new Date();
        this.processed = { succeeded: 0, failed: 0 };
        this.initProcessed = this.getNumProcessed();

        this._intervals.runtime = setInterval(
            this.checkRuntime.bind(this),
            1000 * 60
        );
    }

    getNumProcessed() {
        return Object.values(this.processed).reduce((a, b) => a + b, 0);
    }

    async stop() {
        const delta = this.getLifetimeMin();
        console.log(
            `${this.type}: ${JSON.stringify(this.processed)}} jobs ${delta}min`
        );
        process.exit(0);
    }

    getLifetimeMin() {
        return (new Date() - this.startTime) / 60000;
    }

    checkRuntime() {
        const delta = this.getLifetimeMin();
        if (delta >= this.restart_every_n_min) {
            setTimeout(this.stop.bind(this), 1000);
        }
    }

    checkNumProcessed() {
        const maxJobsPerRun = this._settings.max_jobs_per_run
            ? this._settings.max_jobs_per_run
            : 100;
        const processed = this.getNumProcessed() - this.initProcessed;
        if (processed >= maxJobsPerRun) {
            setTimeout(this.stop.bind(this), 1000);
            if (processed % (this._settings.max_jobs_per_run / 4) == 0) {
                const delta = this.getLifetimeMin();
                console.debug(`  ${this.type}: ${processed} in ${delta}min`);
            }
        }
    }

    async pingHealthcheckUrl(isStart) {
        // NOTE: the success signal must not have a trailing /
        const path = isStart ? "/start" : "";
        const url = `${this.healthcheck_url}${path}`;
        if (!url) {
            console.debug(`  healthcheck_url not set...`);
            return;
        }
        try {
            await axios.get(url, { timeout: 5000 });
            console.debug(`  healthcheck: success isStart=${isStart}`);
        } catch (error) {
            console.error(`  healthcheck: failed isStart=${isStart} - ${error}`);
        }
    }
}

class QueueWorker extends Worker {
    constructor(settings, type) {
        super(settings, type);
        this.queue = null;
    }


    async init() {
        super.init();

        await queue_utils.waitForQueueReady(this.queue);
        // this.queue.process(1, this.processJob.bind(this));
        this.queue.process(1, async (job) => {
            return await this.processJob(job);
        });
        queue_utils.queueCheckStalledJobs(this.queue);
        console.log(`${this.type} started...`);
    }

    async initSingleJob(job) {
        await super.init();

        console.log(`${this.type} started...`);

        await this.processJob(job);
        this.stop();
    }

    async processJob(job) {
        let result = null;
        let error = null;
        const startTime = new Date();
        const jobDetails = JSON.stringify(job.data);
        console.log(
            `Got job ${job.id} ${startTime} ${job.data.domain} ${jobDetails}`
        );
        await this.pingHealthcheckUrl(true);
        try {
            result = await this._processJob(job);
            this.processed.succeeded += 1;
            await this.pingHealthcheckUrl(false);
        } catch (err) {
            error = err;
            this.processed.failed += 1;
        } finally {
            setTimeout(this.checkNumProcessed.bind(this), 1000);
            const delta = (new Date() - startTime) / 1000;
            const logModifier = !error ? 'SUCCEEDED' : 'FAILED';
            console.log(
                `Job ${logModifier}: ${job.id} ${job.data.domain}, ${delta}s`
            );
        }

        if (error) {
            console.error(error);
        }
        return result;
    }

    async _processJob(job) {
        throw new Error('_processJob is not overridden!');
    }
}

class Crawler extends QueueWorker {
    constructor(settings) {
        super(settings, WORKER_TYPES.COLLECTOR);
        this._settings = settings;
        this.queue = new Queue(
            this._settings.queues.crawl,
            this._settings.queues.options.main_worker,
        );

        this.restart_every_n_min = this._settings.crawler.restart_every_n_min;
        this.healthcheck_url = this._settings.crawler.healthcheck_url;
    }

    static async getResponse(cdpClient, requestId) {
        try {
            const response = await cdpClient.send('Network.getResponseBody', { requestId });
            return response;
        } catch (err) {
            // console.error(`Error fetching response body: ${err.message}`);
            return null;
        }
    }

    async _processJob(job) {
        const { domain, rank, timeout } = job.data;
        const url = `https://${domain}`;
        console.log(`  Crawling: ${domain} ${rank}`);

        const browser = await chromium.launch({
            channel: "chrome",
            headless: true, // not the best, but much simpler
        });
        const context = await browser.newContext();
        const page = await context.newPage();
        page.setDefaultTimeout(timeout);
        const cdpClient = await page.context().newCDPSession(page);

        await cdpClient.send('Network.enable');
        await cdpClient.send('Debugger.enable');
        await cdpClient.send('Log.enable');

        const requestMetadata = {};
        const requestIdOrder = [];
        const originalRequestUrls = {};
        const failedSriUrls = [];

        cdpClient.on('Log.entryAdded', (parameters) => {
            const entry = parameters.entry;
            const match = entry.text.match(
                this._settings.crawler.keep_err_log_re
            );
            if (entry.source === 'security' && entry.level === 'error' && match) {
                failedSriUrls.push(match.groups.url);
            }
        });

        cdpClient.on('Network.requestWillBeSent', (params) => {
            if (!params.request.url.startsWith('http')) return;
            const requestId = params.requestId;
            if (!(requestId in originalRequestUrls)) {
                originalRequestUrls[requestId] = params.request.url;
            }
            requestMetadata[requestId] = {};
            requestMetadata[requestId]['reqParams'] = params;
            if (!requestIdOrder.includes(requestId)) {
                requestIdOrder.push(requestId);
            }
        });

        cdpClient.on('Network.responseReceived', (params) => {
            const requestId = params.requestId;
            if (requestId in requestMetadata) {
                requestMetadata[requestId]['respParams'] = params;
            }
        });

        cdpClient.on('Network.loadingFinished', async (params) => {
            const requestId = params.requestId;
            if (requestId in requestMetadata) {
                try {
                    const resp = await Crawler.getResponse(cdpClient, requestId);
                    if (resp["base64Encoded"]) {
                        resp["bodyBinary"] = resp["body"];
                    } else {
                        resp["bodyText"] = resp["body"];
                    }
                    delete resp["body"];
                    requestMetadata[requestId].response = resp;
                } catch (err) { }
            }
        });

        cdpClient.on('Network.loadingFailed', (params) => {
            const requestId = params.requestId;
            if (requestId in requestMetadata) {
                const reqMetadata = requestMetadata[requestId];
                reqMetadata.loadingFailed = true;
                reqMetadata.reqParams.loadingFailedError = params.errorText;
                reqMetadata.reqParams.loadingFailedCanceled = params.canceled;
                reqMetadata.reqParams.loadingFailedBlocked = params.blockedReason;
                reqMetadata.reqParams.loadingFailedCors = params.corsErrorStatus?.corsError;
            }
        });

        let pageError = null;
        try {
            await page.goto(url);
            await page.waitForTimeout(5000);
        } catch (error) {
            pageError = error.toString().split("\n")[0];
            console.error(error);
        } finally {
            await browser.close();
        }

        // The crawler will save data to the following locations:
        // 0. a daily index pattern with all request metadata
        // 1. high-level index pattern with docs describing the crawl
        // 2. medium-level index pattern with docs describing requests and responses
        // 3. low-level index (single is probably ok) with docs representing the response sources 

        const data = {
            domain: domain,
            page: url,
            pageError: pageError,
            requestMetadata: requestMetadata,
            requestIdOrder: requestIdOrder,
            originalRequestUrls: originalRequestUrls,
        };
        debugger;

        try {
            await dbi.createRequests(data);
        } catch (error) {
            console.error(error);
        }

        return;
    }
}

class Scheduler extends Worker {
    constructor(settings, queues, jobs) {
        super(settings, WORKER_TYPES.SCHEDULER);

        this.queues = queues;
        this.jobs = jobs;
        this.setTimeoutsOnSuccess = true;

        this.jobResults = {};
        this.restart_every_n_min = this._settings.crawl_scheduler.restart_every_n_min;
        this.healthcheck_url = this._settings.crawl_scheduler.healthcheck_url;
        this._intervals.monitorJobs = null;
        this._intervals.monitorQueues = null;
    }

    async init() {
        super.init();
        await dbi.setupIndexes();

        await this.setupQueues(this.queues);
        this.initJobResults();
        this.monitorJobResults();
        this._intervals.monitorJobs = setInterval(
            this.monitorJobResults.bind(this), 1000 * 60 * 2
        );
        await this.monitorQueues();
        this._intervals.monitorQueues = setInterval(
            this.monitorQueues.bind(this), 1000 * 60 * 5
        );
    }

    async initSingleJob() {
        this.init();
        this.setTimeoutsOnSuccess = false;
    }

    initJobResults() {
        for (const [_, type] of Object.entries(WORKER_TYPES)) {
            this.jobResults[type] = {
                succeeded: 0,
                failed: 0,
            };
        }
    }

    monitorJobResults() {
        let str = `Periodic results ${new Date()}...\n`;
        str += '  Queue: Succeeded Failed\n';
        for (const [_, type] of Object.entries(WORKER_TYPES)) {
            const { succeeded, failed } = this.jobResults[type];
            str += `  ${type}: ${succeeded} ${failed}\n`;
        }
        str = str.substring(0, str.length - 1);
        console.log(str);
    }

    async monitorQueues() {
        let str = `Periodic queue health check ${new Date()}...\n`;
        str += '  Queue: Health\n';
        for (const [_, queue] of Object.entries(this.queues)) {
            const health = await queue.checkHealth();
            str += `  ${queue.name}: ${JSON.stringify(health)}\n`;
        }
        str = str.substring(0, str.length - 1);
        console.log(str);
    }

    static logJobResult(job, jobId, jobType, succeeded, err) {
        const currentTime = new Date();
        const currentTimeISO = currentTime.toISOString();
        const logModifier = succeeded ? 'succeeded' : 'FAILED';
        const error = succeeded ? '' : err;
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

    async setupQueues() {
        const config = this._settings;
        const queues = this.queues;
        const jobResults = this.jobResults;

        const queueReadyPromises = Object.values(queues).map((q) =>
            queue_utils.waitForQueueReady(q)
        );
        await Promise.all([...queueReadyPromises, dbi.setupIndexes()]);
        for (const [type, queue] of Object.entries(queues)) {
            const getJob = promisify(queue.getJob.bind(queue));
            queue.on('job succeeded', async (jobId, result) => {
                let job = await getJob(jobId);
                const _result = cloneDeep(result);
                Scheduler.logJobResult(job, jobId, type, true);
                jobResults[type].succeeded += 1;
                job = null; // remove reference
                result = null; // remove reference
            });
            queue.on('job failed', async (jobId, err) => {
                let job = await getJob(jobId);
                Scheduler.logJobResult(job, jobId, type, false, err);
                jobResults[type].failed += 1;
                switch (type) {
                    case WORKER_TYPES.COLLECTOR:
                        setTimeout(
                            enqueueQueueJob,
                            queue,
                            config.intervals.retry_failed_crawl,
                            job.data.domain,
                            job.data.rank,
                            true
                        );
                        break;
                }
                job = null; // remove reference
            });
            queue.on('error', (err) => {
                console.log(`${type} queue error: ${err.message}`);
            });
            queue.on('retrying', (job, err) => {
                console.log(
                    `${type} job retrying: ${job.id} ${job.data.domain} ${err.message}!`
                );
            });
            queue.on('stalled', (jobId) => {
                console.log(
                    `${type} job stalled and will be reprocessed: ${jobId}`
                );
            });
        }
    }

    async enqueueQueueJob(queue, domain, rank, save) {
        const job = queue
            .createJob({
                // sites: [],
                domain: domain,
                rank: rank,
                queueTime: new Date().toISOString(), // logging
                // waitUntil: config.collector.wait_until,
                // persistCache: false,
                // maxDepth: 1, // do not follow links
                // obeyRobotsTxt: false,
                timeout: this._settings.page_timeout,
                // retryCount: config.collector.retry_count,
                // extraHeaders: config.extra_headers,
                // userAgent: config.user_agent,
                // puppeteerArgs: config.puppeteer_args,
                // device: config.device,
            })
            .timeout(this._settings.intervals.crawl_job_timeout)
            .retries(this._settings.queues.retry_count);
        if (save) {
            await job.save();
            console.log(
                `Queue job enqueued: ${queue.name} ${job.data.queueTime} ${job.id} ${job.data.domain}`
            );
        } else {
            return job;
        }
    }

    async pushJobs() {
        const jobs = this.jobs;
        await this.pingHealthcheckUrl(true);
        for (const [workerType, domainRanks] of Object.entries(jobs)) {
            const queue = this.queues[workerType];

            console.log(`Processing jobs for ${queue.name}`);
            const queueJobs = domainRanks.map((d) => {
                return this.enqueueQueueJob(queue, d.domain, d.rank, false);
            });
            const queueJobsAwaited = await Promise.all(queueJobs);
            const errors = await queue.saveAll(queueJobsAwaited);
            for (const [job, err] of Object.entries(errors)) {
                console.log(`  Error pushing job ${job.data.domain}`, err);
            }
            console.log(`  Pushed jobs to queue: ${queue.name} ${domainRanks.length}`);
        }
        await this.pingHealthcheckUrl(false);
    }

}

export default {
    WORKER_TYPES,
    Worker,
    Crawler,
    Scheduler,
}