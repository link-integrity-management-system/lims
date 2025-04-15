const path = require("path");
// const os = require("os");
const fs = require("fs/promises");
const process = require("process");

// const axios = require("axios").default;
const Queue = require("bee-queue");
// const { DateTime } = require("luxon");

const config = require("/home/ubuntu/app/configs/config");
// const HCCrawler = require("/home/ubuntu/app/headless-chrome-crawler");
const utils = require("/home/ubuntu/app/shared/utils_js/utils");
// const pptr_utils = require("/home/ubuntu/app/shared/utils_js/pptr_utils");
const queue_utils = require("/home/ubuntu/app/shared/utils_js/queue_utils");
const verify_utils = require("/home/ubuntu/app/shared/utils_js/verify_utils");
const pm2_utils = require("/home/ubuntu/app/shared/utils_js/pm2_utils");
const dbi = require("/home/ubuntu/app/shared/database_js/dbiface");

const VerifierSimple = require("/home/ubuntu/app/src/verifier").VerifierSimple;

const WORKER_TYPES = verify_utils.WORKER_TYPES;
const VERIFICATION_STRATEGY = verify_utils.VERIFICATION_STRATEGY;
const WORKER_STATUS_DIR = "/home/ubuntu/app/status";
// const ZABBIX_KEYS = {
//     [WORKER_TYPES.COLLECTOR]: "collectors.collector",
// };
// const ZABBIX_UPDATE_CMD = `zabbix_sender -c /etc/zabbix/zabbix_agentd.conf`;

function addDefaultHeaders(item, jobData, cfg) {
    item["userAgent"] = jobData.userAgent;
    item["extraHeaders"] = {
        "X-Info": jobData.extraHeaders["X-Info"]
            ? jobData.extraHeaders["X-Info"]
            : cfg.extra_headers["X-Info"],
    };
}

function createInitialQueue(domain, pages, crawlOpts, jobData, cfg) {
    return pages.map((p) => {
        const item = {
            url: p.url,
            waitUntil: jobData.waitUntil,
            domain: domain,
            elasticID: p.id,
        };
        addDefaultHeaders(item, jobData, cfg);
        if (crawlOpts.headers) {
            for (const [key, val] of Object.entries(jobData.extraHeaders)) {
                item["extraHeaders"][key] = val;
            }
            item["viewport"] = jobData.viewport;
        }
        return item;
    });
}

class Worker {
    constructor(settings, type) {
        this._settings = settings ? settings : {};
        this.queue = null;
        this.type = type;
        this.restart_every_n_min = null; // must be set by subclass
        this._intervals = {};
    }

    // lifecycle
    async init() {
        await dbi.setupIndexes();

        this.startTime = new Date();
        this.processed = await this.readProcessed();
        this.initProcessed = this.getNumProcessed();

        await queue_utils.waitForQueueReady(this.queue);
        this.queue.process(1, this.processJob.bind(this));
        queue_utils.queueCheckStalledJobs(this.queue);
        console.log(`${this.type} started...`);

        this._intervals.runtime = setInterval(
            this.checkRuntime.bind(this),
            1000 * 60
        );
        // this._intervals.zabbix = setInterval(
        //     this.sendZabbixUpdate.bind(this),
        //     1000 * 60
        // );
    }

    async initSingleJob(job) {
        this.startTime = new Date();
        this.processed = await this.readProcessed();
        this.initProcessed = this.getNumProcessed();

        console.log(`${this.type} started...`);

        this._intervals.runtime = setInterval(
            this.checkRuntime.bind(this),
            1000 * 60
        );
        // this._intervals.zabbix = setInterval(
        //     this.sendZabbixUpdate.bind(this),
        //     1000 * 60
        // );

        try {
            await this.processJob(job);
        } catch (err) {
            console.error(err);
        } finally {
            this.stop();
        }
    }

    async stop() {
        await this.writeProcessed();
        const delta = this.getLifetimeMin();
        console.log(
            `${this.type}: ${JSON.stringify(this.processed)} jobs ${delta}min`
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

    getNumProcessed() {
        return Object.values(this.processed).reduce((a, b) => a + b, 0);
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

    // async sendZabbixUpdate() {
    //     const idx = await utils.getPM2ProcessIndex(this.type);
    //     const key = `${ZABBIX_KEYS[this.type]}${idx}`;
    //     const success_cmd = `${ZABBIX_UPDATE_CMD} -k ${key}.success -o ${this.processed.succeeded}`;
    //     const fail_cmd = `${ZABBIX_UPDATE_CMD} -k ${key}.fail -o ${this.processed.failed}`;
    //     for (const cmd of [success_cmd, fail_cmd]) {
    //         console.debug(`  zabbix: ${cmd}`);
    //         try {
    //             const { _, stderr } = await exec(cmd);
    //             if (stderr.length > 0) {
    //                 console.error(stderr);
    //             }
    //         } catch (err) {
    //             console.error(err);
    //         }
    //     }
    //     await this.writeProcessed();
    // }

    // status
    async getWorkerStatusFile() {
        let suffix = "-";
        try {
            suffix += await pm2_utils.getPM2ProcessIndex(this.type);
        } catch (err) {
            // do nothing
        }
        return path.join(WORKER_STATUS_DIR, `${this.type}${suffix}.json`);
    }

    async readProcessed() {
        const filename = await this.getWorkerStatusFile();
        try {
            const contents = await fs.readFile(filename, { encoding: "utf8" });
            console.debug(
                `  readProcessed file exists: ${filename} ${contents}`
            );
            return JSON.parse(contents);
        } catch (err) {
            console.debug(`  readProcessed file does not exist: ${filename}`);
            return {
                succeeded: 0,
                failed: 0,
            };
        }
    }

    async writeProcessed() {
        await fs.mkdir(WORKER_STATUS_DIR, { recursive: true });
        const filename = await this.getWorkerStatusFile();
        await fs.writeFile(filename, JSON.stringify(this.processed));
    }

    // processing
    async _processJob(job) {
        throw new Error("_processJob is not overridden!");
    }

    async _runWithRetries(_process, job) {
        let retry = 0;
        let wait = 1000;
        let resp = null;
        let error = null;
        while (retry < this._settings.max_retries_on_err) {
            try {
                resp = await _process.bind(this)(job);
                break;
            } catch (err) {
                console.error(`  job err attempt ${retry}: ${job.id}`, err);
                error = err;
                retry += 1;
            }
            if (retry >= this._settings.elastic.max_retries_on_err) {
                throw error; // the last error
            }
            await new Promise((resolve, _) =>
                setTimeout(resolve, wait * Math.pow(2, retry))
            );
        }
        return {
            resp: resp,
            retry: retry,
        };
    }

    async processJob(job) {
        let result = null;
        let error = null;
        const startTime = new Date();
        const jobDetails =
            this.type === WORKER_TYPES.SERIALIZER
                ? `${Object.keys(job.data.pageData).length} ${job.data.queueTime
                }`
                : JSON.stringify(job.data);
        console.log(
            `Got job ${job.id} ${startTime} ${job.data.domain} ${jobDetails}`
        );
        try {
            result = await this._processJob(job);
            this.processed.succeeded += 1;
        } catch (err) {
            error = err;
            this.processed.failed += 1;
        } finally {
            setTimeout(this.checkNumProcessed.bind(this), 1000);
            const delta = (new Date() - startTime) / 1000;
            const logModifier = !error ? "SUCCEEDED" : "FAILED";
            console.log(
                `Job ${logModifier}: ${job.id} ${job.data.domain}, ${delta}s`
            );
        }

        if (error) {
            console.error(error);
            throw error;
        }
        return result;
    }
}

class VerifyWorker extends Worker {
    constructor(settings) {
        super(settings, WORKER_TYPES.VERIFIER);
        this.queue = new Queue(
            this._settings.queues.verify,
            this._settings.queues.options.main_worker
        );
        // random off-set so the verifiers do not all stop and start in sync
        this.restart_every_n_min = this._settings.verifier.restart_every_n_min + Math.random();
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

    async _processJob(job) {
        const { domain, page, urlTarget } = job.data;
        const { policies, links } = await dbi.getPolicyLinks(domain, page, urlTarget);
        const strategies = {};
        for (const [policyID, policy] of Object.entries(policies)) {
            const strategy = policy.strategy
                ? policy.strategy
                : VERIFICATION_STRATEGY.SIMPLE;
            utils.initKeyVal(strategies, strategy, []);
            strategies[strategy].push(policyID);
        }

        const tasks = [];
        for (const [strategy, policyIDs] of Object.entries(strategies)) {
            const workerPolicies = Object.fromEntries(
                policyIDs.map((x) => [x, policies[x]])
            );
            const workerLinks = Object.fromEntries(
                Object.keys(links)
                    .filter(x => policyIDs.includes(x))
                    .map((x) => [x, links[x]])
            );
            const workerOpts = {
                domain: domain,
                policies: workerPolicies,
                links: workerLinks,
            };

            let verifyWorker = null;
            switch (strategy) {
                case VERIFICATION_STRATEGY.SIMPLE:
                    verifyWorker = new VerifierSimple(this._settings);
                    break;
                default:
                    break;
            }
            const task = verifyWorker._verify(workerOpts);
            tasks.push(task);
        }

        const results = await Promise.all(tasks);
        const summary = {};
        const verifications = [];
        const policyDataLinksToUpdate = [];
        // debugger;

        // 0. aggregate results
        for (const workerResults of results) {
            for (const [linkID, linkVerification] of Object.entries(
                workerResults.status
            )) {
                summary[linkID] = linkVerification;
                verifications.push(...linkVerification.verifications);
            }
            policyDataLinksToUpdate.push(...workerResults.policyDataLinksToUpdate);
        }
        // 0. create/update data links
        await dbi.updatePolicyDataLinkVals(policyDataLinksToUpdate);

        // 1. create link & verification docs
        await dbi.indexVerifications(verifications);
    }
}

module.exports = {
    WorkerTypes: WORKER_TYPES,
    Worker: Worker,
    VerifyWorker: VerifyWorker,
};