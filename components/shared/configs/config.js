var config = {};

// api
config.vapid = {};
config.vapid.public = process.env.VAPID_PUBLIC_KEY;
config.vapid.claims_file = process.env.VAPID_CLAIMS_FILE;

// crawl
config.compress = process.env.ELASTIC_COMPRESS === "true";
config.extra_headers = {
    "Accept-Encoding": "gzip, deflate",
    // 'Accept-Language': 'en-US,en;q=0.9', # header is lower-cased with page.setExtraHTTPHeaders
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
    "X-Info": "cs.stonybrook.edu/~josso/.lms.html",
};
config.user_agent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36";
config.page_timeout = parseInt(process.env.PAGE_TIMEOUT, 10) * 1000;
config.puppeteer_args = [
    // "--disable-web-security",
    // "--disable-features=IsolateOrigins",
    // "--disable-site-isolation-trials",
    "--window-size=1920,1080",
    "--lang=en-US,en;q=0.9",
    "--no-sandbox", // for docker
];
config.max_jobs_per_run = parseInt(process.env.MAX_JOBS_PER_RUN, 10);
config.max_retries_on_err = parseInt(process.env.MAX_RETRIES_ON_ERR, 10);

// config.redis
config.redis = {};
config.redis.host = process.env.REDIS_HOST;
config.redis.port = parseInt(process.env.REDIS_PORT, 10);

// config.queues
config.queues = {};
config.queues.retry_count = parseInt(process.env.QUEUE_RETRY_COUNT, 10);
config.queues.crawl = process.env.QUEUE_CRAWL;
config.queues.verify = process.env.QUEUE_VERIFY;
config.queues.options = {};
config.queues.options.mgr = {
    redis: config.redis,
    isWorker: false,
};
config.queues.options.main_worker = {
    redis: config.redis,
    isWorker: true,
    getEvents: false,
};

// config.intervals
// - used for scheduling jobs
config.intervals = {};
config.intervals.crawl_job_timeout = parseInt(
    process.env.INTERVAL_CRAWL_JOB_TIMEOUT_MS,
    10
);
config.intervals.eval_job_timeout = parseInt(
    process.env.INTERVAL_EVAL_JOB_TIMEOUT_MS,
    10
);
config.intervals.job_timeout = parseInt(
    process.env.INTERVAL_JOB_TIMEOUT_MS,
    10
);
config.intervals.poll_verify = parseInt(
    process.env.INTERVAL_POLL_VERIFIY_MS,
    10
);
config.intervals.check_success_crawl = parseInt(
    process.env.INTERVAL_CHECK_SUCCESS_CRAWL,
    10
) * 60 * 60 * 1000;
config.intervals.retry_failed_crawl = parseInt(
    process.env.INTERVAL_RETRY_FAILED_CRAWL,
    10
) * 60 * 60 * 1000;

// config.arena
// - used by arena service
config.arena = {};
config.arena.host = process.env.ARENA_HOST;
config.arena.port = parseInt(process.env.ARENA_PORT, 10);

// config.elastic
// - used by elastic_settings
config.elastic = {};
config.elastic.password = process.env.ELASTIC_PASSWORD;
config.elastic.certs_dir = process.env.ELASTIC_CERTS_DIR;
config.elastic.ca_fingerprint = process.env.ELASTIC_CA_FINGERPRINT;
config.elastic.prefix = process.env.ELASTIC_PREFIX;
config.elastic.nodes = process.env.ELASTIC_NODES.split(",");
config.elastic.timeout_ms = parseInt(process.env.ELASTIC_TIMEOUT_S, 10) * 1000;
config.elastic.index_settings = {};
config.elastic.index_settings.num_shards = parseInt(
    process.env.ELASTIC_INDEX_NUM_SHARDS,
    10
);
config.elastic.index_settings.num_replicas_primary = parseInt(
    process.env.ELASTIC_INDEX_NUM_REPLICAS_PRIMARY,
    10
);
config.elastic.index_settings.num_replicas_derived = parseInt(
    process.env.ELASTIC_INDEX_NUM_REPLICAS_DERIVED,
    10
);
config.elastic.index_settings.refresh_interval =
    process.env.ELASTIC_INDEX_REFRESH_INTERVAL;
config.elastic.index_settings.compression_level =
    process.env.ELASTIC_INDEX_COMPRESSION_LEVEL;
config.elastic.index_settings.total_shards_per_node = parseInt(
    process.env.ELASTIC_INDEX_TOTAL_SHARDS_PER_NODE,
    10
);

// config.verifier
// - used by verifier service
config.verifier = {};
config.verifier.restart_every_n_min = parseInt(
    process.env.VERIFIER_RESTART_EVERY_N_MIN,
    10
);
config.verifier.simple = {};
config.verifier.simple.timeout = parseInt(
    process.env.VERIFIER_SIMPLE_TIMEOUT,
    10
);
config.verifier.req_timeout = parseInt(
    process.env.VERIFIER_REQ_TIMEOUT,
    10
);
config.verifier.num_workers = parseInt(
    process.env.VERIFIER_NUM_WORKERS,
    10
);

// config.wait
// - used by pptr_utils
config.wait = {};
config.wait.html = {};
config.wait.html.timeout = parseInt(process.env.WAIT_HTML_TIMEOUT, 10) * 1000;
config.wait.html.iter = parseInt(process.env.WAIT_HTML_ITER, 10);
config.wait.network = {};
config.wait.network.timeout =
    parseInt(process.env.WAIT_NETWORK_TIMEOUT, 10) * 1000;

// config.lms
config.lms = {};
config.lms.modes = {};
config.lms.modes.noop = "noop";             // api does nothing
config.lms.modes.discovery = "discovery";   // api creates links
config.lms.modes.normal = "normal";         // api is fully functional
config.lms.mode = process.env.LMS_API_MODE; // not used for evaluation
config.lms.api_key = process.env.LMS_API_KEY;

// config.crawler
config.crawler = {};
config.crawler.keep_err_log_re =
    /Failed to find a valid digest in the 'integrity' attribute for resource '(?<url>.*)' with computed (?<alg>SHA-256|SHA-384|SHA-512) integrity '(?<hash>.*)'\. The resource has been blocked\./;
config.crawler.restart_every_n_min = parseInt(
    process.env.COLLECTOR_RESTART_EVERY_N_MIN,
    10
);
config.crawler.healthcheck_url = process.env.COLLECTOR_HEALTHCHECK;

// config.crawl_scheduler
config.crawl_scheduler = {};
config.crawl_scheduler.domains_list = process.env.CRAWLSCHEDULER_DOMAINS_LIST;
config.crawl_scheduler.healthcheck_url = process.env.CRAWLSCHEDULER_HEALTHCHECK;
config.crawl_scheduler.restart_every_n_min = parseInt(
    process.env.CRAWLSCHEDULER_RESTART_EVERY_N_MIN,
    10
);

export default config;
