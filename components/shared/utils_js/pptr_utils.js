const config = require("/home/ubuntu/app/configs/config");

const clearCrawlerCache = async (crawler) => {
    await crawler.clearCache();
    const page = await crawler._browser.newPage();
    const client = await page.target().createCDPSession();
    await client.send("Network.clearBrowserCookies");
    await client.send("Network.clearBrowserCache");
    await page.close();
    crawler._queue.clear();
};

const closeCrawlerPages = async (crawler) => {
    const pages = await crawler._browser.pages();
    const closePromises = pages.map((p) => p.close());
    return Promise.allSettled(closePromises);
};

/**
 * https://github.com/puppeteer/puppeteer/issues/1353
 */
const waitForNetworkIdle = ({
    page,
    timeout = config.wait.network.timeout,
    waitForFirstRequest = 1000,
    waitForLastRequest = 200,
    maxInflightRequests = 0,
}) => {
    let inflight = 0;
    let resolve;
    let reject;
    let firstRequestTimeoutId;
    let lastRequestTimeoutId;
    let timeoutId;
    maxInflightRequests = Math.max(maxInflightRequests, 0);

    function cleanup() {
        clearTimeout(timeoutId);
        clearTimeout(firstRequestTimeoutId);
        clearTimeout(lastRequestTimeoutId);
        /* eslint-disable no-use-before-define */
        page.removeListener("request", onRequestStarted);
        page.removeListener("requestfinished", onRequestFinished);
        page.removeListener("requestfailed", onRequestFinished);
        /* eslint-enable no-use-before-define */
    }

    function check() {
        if (inflight <= maxInflightRequests) {
            clearTimeout(lastRequestTimeoutId);
            lastRequestTimeoutId = setTimeout(
                onLastRequestTimeout,
                waitForLastRequest
            );
        }
    }

    function onRequestStarted() {
        clearTimeout(firstRequestTimeoutId);
        clearTimeout(lastRequestTimeoutId);
        inflight += 1;
    }

    function onRequestFinished() {
        inflight -= 1;
        check();
    }

    function onTimeout() {
        cleanup();
        reject(new Error("NetworkIdleTimeout"));
    }

    function onFirstRequestTimeout() {
        cleanup();
        resolve();
    }

    function onLastRequestTimeout() {
        cleanup();
        resolve();
    }

    page.on("request", onRequestStarted);
    page.on("requestfinished", onRequestFinished);
    page.on("requestfailed", onRequestFinished);

    timeoutId = setTimeout(onTimeout, timeout); // Overall page timeout
    firstRequestTimeoutId = setTimeout(
        onFirstRequestTimeout,
        waitForFirstRequest
    );

    return new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
};

class CrawlerListeners {
    constructor(crawler, domain) {
        this.crawler = crawler;
        this.domain = domain;
        this.start = new Date();
        this.setup();
    }

    static onRequestDisallowed(crawler, domain) {
        crawler.on("requestdisallowed", (options) => {
            console.debug(`  crawler.requestdisallowed:`, domain, options);
        });
    }

    static onRequestSkipped(crawler, domain) {
        crawler.on("requestskipped", (options) => {
            console.debug(`  crawler.requestskipped:`, domain, options.url);
        });
    }

    static onRequestStarted(crawler, domain) {
        crawler.on("requeststarted", (options) => {
            console.debug(`  crawler.requeststarted: ${domain} ${options.url}`);
        });
    }

    static onRequestRetried(crawler, domain) {
        crawler.on("requestretried", (options, err) => {
            console.debug(
                `  crawler.requestretried: ${domain} ${options.url}`,
                err
            );
        });
    }

    static onDisconnected(crawler, domain) {
        crawler.on("disconnected", (err) => {
            console.debug(`  crawler.disconnected... ${domain}`, err);
        });
    }

    static onRequestFinished(crawler, domain) {
        crawler.on("requestfinished", (options) => {
            console.debug(
                `  crawler.requestfinished: ${domain} ${options.url}`
            );
        });
    }

    static onMaxRequestReached(crawler, domain) {
        crawler.on("maxrequestreached", () => {
            console.debug(
                `  crawler.maxrequestreached ${domain} ${crawler._options.maxRequest}`
            );
        });
    }

    static onRobotsTxtRequestFailed(crawler, domain) {
        crawler.on("robotstxtrequestfailed", (err) => {
            console.debug(
                `  crawler.robotstxtrequestfailed: ${domain} ${err.statusCode} ${err.options.url}`
            );
        });
    }

    static onRequestFailed(crawler, domain) {
        crawler.on("requestfailed", (err) => {
            console.debug(`  crawler.requestfailed:`, domain, err);
        });
    }

    static onSiteMapXMLRequestFailed(crawler, err) {
        crawler.on("sitemapxmlrequestfailed", (err) => {
            console.debug(
                `  crawler.sitemapxmlrequestfailed: ${err.options.url} ${err.statusCode} ${err.error}`
            );
        });
    }

    static async healthCheck(crawler, domain, start) {
        const delta = new Date() - start;
        if (delta >= config.intervals.job_timeout_kill) {
            console.debug(`healthCheck domain=${domain} timed out...`);
            crawler.pauseFinished();
        }
        const isPaused = crawler.isPaused();
        const queueSize = await crawler.queueSize();
        const pendingQueueSize = await crawler.pendingQueueSize();
        console.debug(
            `healthCheck domain=${domain} delta=${
                delta / 1000
            }s pending=${pendingQueueSize} queued=${queueSize} paused=${isPaused} finished=${
                crawler.finished
            }`
        );
    }

    setup() {
        CrawlerListeners.onRequestDisallowed(this.crawler, this.domain);
        CrawlerListeners.onRequestSkipped(this.crawler, this.domain);
        CrawlerListeners.onRequestStarted(this.crawler, this.domain);
        CrawlerListeners.onRequestRetried(this.crawler, this.domain);
        CrawlerListeners.onDisconnected(this.crawler, this.domain);
        CrawlerListeners.onRequestFinished(this.crawler, this.domain);
        CrawlerListeners.onRequestFailed(this.crawler, this.domain);
        CrawlerListeners.onMaxRequestReached(this.crawler, this.domain);
        CrawlerListeners.onRobotsTxtRequestFailed(this.crawler, this.domain);
        CrawlerListeners.onSiteMapXMLRequestFailed(this.crawler, this.domain);
        this.healthCheckInterval = setInterval(
            CrawlerListeners.healthCheck,
            10000,
            this.crawler,
            this.domain,
            this.start
        );
    }

    teardown() {
        this.crawler.removeAllListeners();
        // this.crawler.removeListener(
        //     'requestdisallowed',
        //     this.onRequestDisallowed
        // );
        // this.crawler.removeListener('requestskipped', this.onRequestSkipped);
        // this.crawler.removeListener('requeststarted', this.onRequestStarted);
        // this.crawler.removeListener('requestretried', this.onRequestRetried);
        // this.crawler.removeListener('disconnected', this.onDisconnected);
        // this.crawler.removeListener('requestfinished', this.onRequestFinished);
        // this.crawler.removeListener(
        //     'maxrequestreached',
        //     this.onMaxRequestReached
        // );
        // this.crawler.removeListener(
        //     'robotstxtrequestfailed',
        //     this.onRobotsTxtRequestFailed
        // );
        // this.crawler.removeListener('requestfailed', this.onRequestFailed);
        // this.crawler.removeListener(
        //     'sitemapxmlrequestfailed',
        //     this.onSiteMapXMLRequestFailed
        // );
        clearInterval(this.healthCheckInterval);
    }
}

module.exports = {
    clearCrawlerCache: clearCrawlerCache,
    closeCrawlerPages: closeCrawlerPages,
    waitForNetworkIdle: waitForNetworkIdle,
    CrawlerListeners: CrawlerListeners,
};
